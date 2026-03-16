const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  author: {
    name: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    role: { type: String, default: 'user' }
  },
  text: { type: String, required: true, maxlength: 1000 },
  isAdminNote: { type: Boolean, default: false },
  edited: { type: Boolean, default: false },
  mentions: [String]   // array of @username strings found in text
}, { timestamps: true });

const issueSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, maxlength: 2000 },
  category: {
    type: String, required: true,
    enum: ['Infrastructure', 'Safety', 'Sanitation', 'Community Resources', 'Environment', 'Transportation', 'Other']
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  tags: [{ type: String, maxlength: 30 }],
  neighborhood: { type: String, trim: true, default: '' },  // NEW: area/neighborhood
  location: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Pending Review', 'Resolved'],
    default: 'Open'
  },
  reporter: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  assignedTo: {   // NEW: staff/admin assignment
    name: { type: String, default: '' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  supporters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  supportCount: { type: Number, default: 0 },
  watchers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],  // NEW
  images: [String],
  comments: [commentSchema],
  updates: [{
    message: String,
    status: String,
    updatedBy: String,
    updatedAt: { type: Date, default: Date.now }
  }],
  views: { type: Number, default: 0 },
  resolutionTimeHours: { type: Number, default: null },  // NEW: computed on resolve
  resolvedAt: Date,
  isLocked: { type: Boolean, default: false }  // NEW: admin can lock comments
}, { timestamps: true });

issueSchema.index({ title: 'text', description: 'text', location: 'text', tags: 'text', neighborhood: 'text' });
issueSchema.index({ neighborhood: 1 });
issueSchema.index({ status: 1, createdAt: -1 });
issueSchema.index({ priority: 1 });

module.exports = mongoose.model('Issue', issueSchema);
