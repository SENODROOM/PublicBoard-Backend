const express = require('express');
const User = require('../models/User');
const Issue = require('../models/Issue');
const Donation = require('../models/Donation');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth + admin role
router.use(protect, adminOnly);

// ── Dashboard Overview ──────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const [
      totalUsers, totalIssues, totalDonations,
      openIssues, inProgressIssues, resolvedIssues, pendingIssues,
      donationStats,
      recentIssues, recentUsers, recentDonations,
      categoryBreakdown, monthlyIssues
    ] = await Promise.all([
      User.countDocuments(),
      Issue.countDocuments(),
      Donation.countDocuments({ status: 'completed' }),
      Issue.countDocuments({ status: 'Open' }),
      Issue.countDocuments({ status: 'In Progress' }),
      Issue.countDocuments({ status: 'Resolved' }),
      Issue.countDocuments({ status: 'Pending Review' }),
      Donation.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 }, avg: { $avg: '$amount' } } }
      ]),
      Issue.find().sort('-createdAt').limit(5).lean(),
      User.find().sort('-createdAt').limit(5).select('-password').lean(),
      Donation.find({ status: 'completed' }).sort('-createdAt').limit(5).lean(),
      Issue.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Issue.aggregate([
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': -1, '_id.month': -1 } },
        { $limit: 6 }
      ])
    ]);

    const ds = donationStats[0] || { total: 0, count: 0, avg: 0 };

    res.json({
      stats: {
        totalUsers, totalIssues, totalDonations,
        openIssues, inProgressIssues, resolvedIssues, pendingIssues,
        totalRaised: ds.total,
        avgDonation: Math.round(ds.avg * 100) / 100,
        resolutionRate: totalIssues > 0 ? Math.round((resolvedIssues / totalIssues) * 100) : 0
      },
      recentIssues,
      recentUsers,
      recentDonations,
      categoryBreakdown,
      monthlyIssues: monthlyIssues.reverse()
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── User Management ─────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { search, role, sort = '-createdAt', page = 1, limit = 20 } = req.query;
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
    if (!user) return res.status(404).json({ message: 'User not found' });
    const issues = await Issue.find({ 'reporter.userId': req.params.id }).sort('-createdAt').lean();
    res.json({ user, issues });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'Cannot change your own role' });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'Cannot delete yourself' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Issue Management ─────────────────────────────────────
router.get('/issues', async (req, res) => {
  try {
    const { status, category, search, sort = '-createdAt', page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { location: { $regex: search, $options: 'i' } },
      { 'reporter.name': { $regex: search, $options: 'i' } }
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

router.patch('/issues/:id', async (req, res) => {
  try {
    const { status, message } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    if (status) {
      issue.status = status;
      if (status === 'Resolved') issue.resolvedAt = new Date();
    }
    if (message) issue.updates.push({ message, status: issue.status, updatedBy: req.user.name + ' (Admin)' });
    await issue.save();
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/issues/:id', async (req, res) => {
  try {
    await Issue.findByIdAndDelete(req.params.id);
    res.json({ message: 'Issue deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Donation Management ──────────────────────────────────
router.get('/donations', async (req, res) => {
  try {
    const { status, sort = '-createdAt', page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [donations, total] = await Promise.all([
      Donation.find(filter).sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      Donation.countDocuments(filter)
    ]);
    res.json({ donations, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Bulk Actions ─────────────────────────────────────────
router.post('/issues/bulk-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    await Issue.updateMany({ _id: { $in: ids } }, { status });
    res.json({ message: `${ids.length} issues updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/issues/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    await Issue.deleteMany({ _id: { $in: ids } });
    res.json({ message: `${ids.length} issues deleted` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
