const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 120 },
  body: { type: String, required: true, maxlength: 600 },
  type: {
    type: String,
    enum: ['info', 'warning', 'success', 'critical'],
    default: 'info'
  },
  isActive: { type: Boolean, default: true },
  pinned: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  createdBy: { type: String, required: true },
  link: { type: String, default: '' },
  linkLabel: { type: String, default: '' },
  dismissible: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Announcement', announcementSchema);
