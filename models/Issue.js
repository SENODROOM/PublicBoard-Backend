const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  category: {
    type: String,
    required: true,
    enum: ['Infrastructure', 'Safety', 'Sanitation', 'Community Resources', 'Environment', 'Transportation', 'Other']
  },
  location: {
    type: String,
    required: true,
    trim: true
  },
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
  supporters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  supportCount: { type: Number, default: 0 },
  images: [String],
  updates: [{
    message: String,
    status: String,
    updatedBy: String,
    updatedAt: { type: Date, default: Date.now }
  }],
  resolvedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Issue', issueSchema);
