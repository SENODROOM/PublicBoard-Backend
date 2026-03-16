const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  actor: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true },
    role: { type: String, default: 'user' }
  },
  action: {
    type: String,
    required: true,
    enum: [
      'issue.created', 'issue.updated', 'issue.deleted', 'issue.status_changed',
      'issue.supported', 'issue.commented', 'issue.watched',
      'user.registered', 'user.login', 'user.role_changed', 'user.deleted',
      'donation.created',
      'admin.announcement_created', 'admin.announcement_deleted',
      'admin.bulk_status', 'admin.bulk_delete'
    ]
  },
  target: {
    type: { type: String },   // 'issue' | 'user' | 'donation' | 'announcement'
    id: String,
    label: String             // human-readable title/name
  },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' }
}, { timestamps: true });

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ 'actor.userId': 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
