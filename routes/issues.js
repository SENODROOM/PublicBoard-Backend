const express = require('express');
const Issue = require('../models/Issue');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Get all issues (public)
router.get('/', async (req, res) => {
  try {
    const { status, category, search, sort = '-createdAt' } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { location: { $regex: search, $options: 'i' } }
    ];
    const issues = await Issue.find(filter).sort(sort).lean();
    res.json({ issues, total: issues.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get stats
router.get('/stats', async (req, res) => {
  try {
    const total = await Issue.countDocuments();
    const open = await Issue.countDocuments({ status: 'Open' });
    const inProgress = await Issue.countDocuments({ status: 'In Progress' });
    const resolved = await Issue.countDocuments({ status: 'Resolved' });
    const pendingReview = await Issue.countDocuments({ status: 'Pending Review' });
    res.json({ total, open, inProgress, resolved, pendingReview });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single issue
router.get('/:id', async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create issue (public — anonymous or logged in)
router.post('/', async (req, res) => {
  try {
    const { title, description, category, location, reporter } = req.body;
    const issue = await Issue.create({ title, description, category, location, reporter });
    res.status(201).json({ issue });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Support an issue (logged in)
router.post('/:id/support', protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    const alreadySupported = issue.supporters.includes(req.user._id);
    if (alreadySupported) {
      issue.supporters.pull(req.user._id);
      issue.supportCount = Math.max(0, issue.supportCount - 1);
    } else {
      issue.supporters.push(req.user._id);
      issue.supportCount += 1;
    }
    await issue.save();
    res.json({ issue, supported: !alreadySupported });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update issue status
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status, message } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    // Only admin or reporter can update
    const isAdmin = req.user.role === 'admin';
    const isReporter = issue.reporter.userId?.toString() === req.user._id.toString();
    if (!isAdmin && !isReporter) {
      return res.status(403).json({ message: 'Not authorized to update this issue' });
    }

    issue.status = status;
    if (status === 'Resolved') issue.resolvedAt = new Date();
    if (message) {
      issue.updates.push({ message, status, updatedBy: req.user.name });
    }
    await issue.save();
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete issue (admin only)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await Issue.findByIdAndDelete(req.params.id);
    res.json({ message: 'Issue deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
