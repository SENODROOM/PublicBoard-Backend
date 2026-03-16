const express = require('express');
const Announcement = require('../models/Announcement');
const ActivityLog = require('../models/ActivityLog');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET active announcements (public)
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const announcements = await Announcement.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    }).sort('-pinned -createdAt').lean();
    res.json({ announcements });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all announcements (admin)
router.get('/all', protect, adminOnly, async (req, res) => {
  try {
    const announcements = await Announcement.find().sort('-createdAt').lean();
    res.json({ announcements });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE announcement (admin)
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { title, body, type, pinned, expiresAt, link, linkLabel, dismissible } = req.body;
    const ann = await Announcement.create({
      title, body, type, pinned, expiresAt: expiresAt || null,
      link, linkLabel, dismissible,
      createdBy: req.user.name
    });
    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: 'admin.announcement_created',
      target: { type: 'announcement', id: ann._id.toString(), label: title }
    });
    res.status(201).json({ announcement: ann });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// TOGGLE active (admin)
router.patch('/:id/toggle', protect, adminOnly, async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ message: 'Not found' });
    ann.isActive = !ann.isActive;
    await ann.save();
    res.json({ announcement: ann });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE announcement (admin)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: 'admin.announcement_deleted',
      target: { type: 'announcement', id: req.params.id, label: 'announcement' }
    });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
