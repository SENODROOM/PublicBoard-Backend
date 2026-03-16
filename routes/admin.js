const express = require('express');
const Issue = require('../models/Issue');
const User = require('../models/User');
const Donation = require('../models/Donation');
const ActivityLog = require('../models/ActivityLog');
const Announcement = require('../models/Announcement');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(protect, adminOnly);

// ── Overview ─────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const [total, open, inProgress, resolved, pendingReview, totalUsers, totalDonations, priorityBreakdown, recentActivity] = await Promise.all([
      Issue.countDocuments(),
      Issue.countDocuments({ status: 'Open' }),
      Issue.countDocuments({ status: 'In Progress' }),
      Issue.countDocuments({ status: 'Resolved' }),
      Issue.countDocuments({ status: 'Pending Review' }),
      User.countDocuments(),
      Donation.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Issue.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      ActivityLog.find().sort('-createdAt').limit(20).lean()
    ]);
    res.json({
      total, open, inProgress, resolved, pendingReview, totalUsers,
      totalDonations: totalDonations[0]?.total || 0,
      priorityBreakdown, recentActivity
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Issues ───────────────────────────────────────────────
router.get('/issues', async (req, res) => {
  try {
    const { status, category, priority, search, page = 1, limit = 20, assignedTo } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (assignedTo === 'me') filter['assignedTo.userId'] = req.user._id;
    if (assignedTo === 'unassigned') filter['assignedTo.userId'] = null;
    if (search) filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { 'reporter.name': { $regex: search, $options: 'i' } }
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [issues, total] = await Promise.all([
      Issue.find(filter).sort('-createdAt').skip(skip).limit(parseInt(limit)).lean(),
      Issue.countDocuments(filter)
    ]);
    res.json({ issues, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/issues/:id', async (req, res) => {
  try {
    const { status, priority, assignedTo, isLocked } = req.body;
    const update = {};
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Not found' });

    if (status && status !== issue.status) {
      update.status = status;
      if (status === 'Resolved') {
        update.resolvedAt = new Date();
        update.resolutionTimeHours = Math.round((new Date() - issue.createdAt) / 3600000);
      }
      await ActivityLog.create({
        actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
        action: 'issue.status_changed',
        target: { type: 'issue', id: issue._id.toString(), label: issue.title },
        meta: { from: issue.status, to: status }
      });
    }
    if (priority) update.priority = priority;
    if (assignedTo !== undefined) update.assignedTo = assignedTo;
    if (isLocked !== undefined) update.isLocked = isLocked;

    const updated = await Issue.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ issue: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Bulk actions
router.post('/issues/bulk', async (req, res) => {
  try {
    const { ids, action, value } = req.body;
    if (!ids?.length) return res.status(400).json({ message: 'No IDs provided' });
    let update = {};
    let logAction = 'admin.bulk_status';
    if (action === 'status') update = { status: value };
    else if (action === 'priority') update = { priority: value };
    else if (action === 'delete') {
      await Issue.deleteMany({ _id: { $in: ids } });
      logAction = 'admin.bulk_delete';
    } else return res.status(400).json({ message: 'Unknown action' });

    if (action !== 'delete') await Issue.updateMany({ _id: { $in: ids } }, update);
    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: logAction,
      meta: { ids, action, value, count: ids.length }
    });
    res.json({ message: 'Bulk action applied', count: ids.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Users ─────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { search, role, page = 1, limit = 20, sort = '-createdAt' } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'Not found' });
    const [reportedCount, supportedCount] = await Promise.all([
      Issue.countDocuments({ 'reporter.userId': user._id }),
      Issue.countDocuments({ supporters: user._id })
    ]);
    res.json({ user: { ...user, reportedCount, supportedCount } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const { role, isBanned, banReason } = req.body;
    const update = {};
    if (role) update.role = role;
    if (isBanned !== undefined) { update.isBanned = isBanned; update.banReason = banReason || ''; }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: 'user.role_changed',
      target: { type: 'user', id: req.params.id, label: user.name },
      meta: update
    });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── Activity log ─────────────────────────────────────────
router.get('/activity', async (req, res) => {
  try {
    const { page = 1, limit = 50, action, actorId } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (actorId) filter['actor.userId'] = actorId;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      ActivityLog.find(filter).sort('-createdAt').skip(skip).limit(parseInt(limit)).lean(),
      ActivityLog.countDocuments(filter)
    ]);
    res.json({ logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Donations CSV ─────────────────────────────────────────
router.get('/donations/export', async (req, res) => {
  try {
    const donations = await Donation.find().sort('-createdAt').lean();
    const headers = ['ID', 'Amount', 'Name', 'Email', 'Status', 'Date'];
    const rows = donations.map(d => [d._id, d.amount, `"${d.name}"`, d.email, d.status, new Date(d.createdAt).toLocaleDateString()]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="donations.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
