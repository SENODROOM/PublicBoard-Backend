const express = require('express');
const Issue = require('../models/Issue');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ── Get all issues ───────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, category, search, sort = '-createdAt', priority, tags, neighborhood, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (neighborhood) filter.neighborhood = { $regex: neighborhood, $options: 'i' };
    if (tags) filter.tags = { $in: tags.split(',') };
    if (search) filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { location: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
      { neighborhood: { $regex: search, $options: 'i' } }
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [issues, total] = await Promise.all([
      Issue.find(filter).sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      Issue.countDocuments(filter)
    ]);
    res.json({ issues, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Stats ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [total, open, inProgress, resolved, pendingReview, priorityBreakdown, topTags, neighborhoods] = await Promise.all([
      Issue.countDocuments(),
      Issue.countDocuments({ status: 'Open' }),
      Issue.countDocuments({ status: 'In Progress' }),
      Issue.countDocuments({ status: 'Resolved' }),
      Issue.countDocuments({ status: 'Pending Review' }),
      Issue.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Issue.aggregate([
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 }
      ]),
      Issue.aggregate([
        { $match: { neighborhood: { $ne: '', $exists: true } } },
        { $group: { _id: '$neighborhood', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 }
      ])
    ]);
    res.json({ total, open, inProgress, resolved, pendingReview, priorityBreakdown, topTags, neighborhoods });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Get related issues ───────────────────────────────────
router.get('/:id/related', async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const related = await Issue.find({
      _id: { $ne: issue._id },
      $or: [
        { category: issue.category },
        { tags: { $in: issue.tags || [] } },
        { neighborhood: issue.neighborhood || '__none__' }
      ]
    }).sort('-supportCount').limit(4).select('title status category supportCount priority').lean();
    res.json({ related });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Get single issue (increment views) ──────────────────
router.get('/:id', async (req, res) => {
  try {
    const issue = await Issue.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Create issue ─────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { title, description, category, location, reporter, priority, tags, neighborhood } = req.body;
    const issue = await Issue.create({
      title, description, category, location, reporter,
      priority: priority || 'Medium',
      tags: tags || [],
      neighborhood: neighborhood || ''
    });

    // Log activity
    await ActivityLog.create({
      actor: { userId: reporter.userId || null, name: reporter.name, role: 'user' },
      action: 'issue.created',
      target: { type: 'issue', id: issue._id.toString(), label: title }
    });

    // Update user stats & badges if logged in
    if (reporter.userId) {
      const user = await User.findById(reporter.userId);
      if (user) {
        user.stats.issuesReportedCount += 1;
        user.reputation += 10;
        // Award badges
        const existingBadgeIds = user.badges.map(b => b.id);
        const User_ = require('../models/User');
        if (user.stats.issuesReportedCount === 1 && !existingBadgeIds.includes('first_report'))
          user.badges.push(User_.BADGES.FIRST_REPORT);
        if (user.stats.issuesReportedCount === 5 && !existingBadgeIds.includes('five_reports'))
          user.badges.push(User_.BADGES.FIVE_REPORTS);
        if (user.stats.issuesReportedCount === 10 && !existingBadgeIds.includes('ten_reports'))
          user.badges.push(User_.BADGES.TEN_REPORTS);
        await user.save();
      }
    }

    res.status(201).json({ issue });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── Support / unsupport ──────────────────────────────────
router.post('/:id/support', protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    const already = issue.supporters.includes(req.user._id);
    if (already) {
      issue.supporters.pull(req.user._id);
      issue.supportCount = Math.max(0, issue.supportCount - 1);
    } else {
      issue.supporters.push(req.user._id);
      issue.supportCount += 1;
      await ActivityLog.create({
        actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
        action: 'issue.supported',
        target: { type: 'issue', id: issue._id.toString(), label: issue.title }
      });
    }
    await issue.save();
    res.json({ issue, supported: !already });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Bookmark / unbookmark ────────────────────────────────
router.post('/:id/bookmark', protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    const bookmarked = issue.bookmarks.includes(req.user._id);
    if (bookmarked) {
      issue.bookmarks.pull(req.user._id);
      await User.findByIdAndUpdate(req.user._id, { $pull: { bookmarks: issue._id } });
    } else {
      issue.bookmarks.push(req.user._id);
      await User.findByIdAndUpdate(req.user._id, { $addToSet: { bookmarks: issue._id } });
    }
    await issue.save();
    res.json({ issue, bookmarked: !bookmarked });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Watch / unwatch ──────────────────────────────────────
router.post('/:id/watch', protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    const watching = issue.watchers.includes(req.user._id);
    if (watching) issue.watchers.pull(req.user._id);
    else issue.watchers.push(req.user._id);
    await issue.save();
    res.json({ issue, watching: !watching });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Add comment ──────────────────────────────────────────
router.post('/:id/comments', protect, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'Comment text required' });
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    if (issue.isLocked && req.user.role === 'user')
      return res.status(403).json({ message: 'Comments are locked on this issue' });

    // Extract @mentions
    const mentions = (text.match(/@(\w+)/g) || []).map(m => m.slice(1));

    issue.comments.push({
      author: { name: req.user.name, userId: req.user._id, role: req.user.role },
      text: text.trim(),
      isAdminNote: req.user.role === 'admin',
      mentions
    });
    await issue.save();

    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: 'issue.commented',
      target: { type: 'issue', id: issue._id.toString(), label: issue.title }
    });

    // Update user comment count
    await User.findByIdAndUpdate(req.user._id, { $inc: { 'stats.commentsCount': 1 } });

    res.status(201).json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Delete comment ───────────────────────────────────────
router.delete('/:id/comments/:commentId', protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const comment = issue.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    const isOwner = comment.author.userId?.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Not authorized' });
    issue.comments.pull(req.params.commentId);
    await issue.save();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Update status ────────────────────────────────────────
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status, message } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    const isAdmin = req.user.role === 'admin' || req.user.role === 'moderator';
    const isReporter = issue.reporter.userId?.toString() === req.user._id.toString();
    if (!isAdmin && !isReporter)
      return res.status(403).json({ message: 'Not authorized' });

    const prevStatus = issue.status;
    issue.status = status;
    if (status === 'Resolved' && prevStatus !== 'Resolved') {
      issue.resolvedAt = new Date();
      const hours = Math.round((issue.resolvedAt - issue.createdAt) / 3600000);
      issue.resolutionTimeHours = hours;
      // Award badge to reporter if logged in
      if (issue.reporter.userId) {
        const user = await User.findById(issue.reporter.userId);
        if (user) {
          user.stats.issuesResolvedCount += 1;
          user.reputation += 25;
          const existingIds = user.badges.map(b => b.id);
          const User_ = require('../models/User');
          if (user.stats.issuesResolvedCount === 1 && !existingIds.includes('first_resolve'))
            user.badges.push(User_.BADGES.FIRST_RESOLVE);
          if (user.stats.issuesResolvedCount === 5 && !existingIds.includes('five_resolves'))
            user.badges.push(User_.BADGES.FIVE_RESOLVES);
          await user.save();
        }
      }
    }
    if (message) issue.updates.push({ message, status, updatedBy: req.user.name });
    await issue.save();

    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: 'issue.status_changed',
      target: { type: 'issue', id: issue._id.toString(), label: issue.title },
      meta: { from: prevStatus, to: status }
    });

    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Lock / unlock comments (admin) ──────────────────────
router.patch('/:id/lock', protect, adminOnly, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    issue.isLocked = !issue.isLocked;
    await issue.save();
    res.json({ issue, locked: issue.isLocked });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Assign issue (admin) ─────────────────────────────────
router.patch('/:id/assign', protect, adminOnly, async (req, res) => {
  try {
    const { userId, name } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });
    issue.assignedTo = { userId: userId || null, name: name || '' };
    await issue.save();
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Delete issue (admin) ─────────────────────────────────
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const issue = await Issue.findByIdAndDelete(req.params.id);
    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: 'issue.deleted',
      target: { type: 'issue', id: req.params.id, label: issue?.title || req.params.id }
    });
    res.json({ message: 'Issue deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── CSV Export (admin) ───────────────────────────────────
router.get('/export/csv', protect, adminOnly, async (req, res) => {
  try {
    const issues = await Issue.find().sort('-createdAt').lean();
    const headers = ['ID', 'Title', 'Category', 'Priority', 'Status', 'Neighborhood', 'Location', 'Reporter', 'Assigned', 'Support', 'Views', 'Comments', 'Resolution (hrs)', 'Created'];
    const rows = issues.map(i => [
      i._id, `"${(i.title || '').replace(/"/g, '""')}"`, i.category, i.priority, i.status,
      `"${(i.neighborhood || '').replace(/"/g, '""')}"`,
      `"${(i.location || '').replace(/"/g, '""')}"`,
      i.reporter?.name, i.assignedTo?.name || '',
      i.supportCount, i.views || 0, i.comments?.length || 0,
      i.resolutionTimeHours || '',
      new Date(i.createdAt).toLocaleDateString()
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="issues.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
