const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const badgeSchema = new mongoose.Schema({
  id: String,
  label: String,
  icon: String,
  earnedAt: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },
  avatar: String,
  bio: { type: String, maxlength: 200, default: '' },
  neighborhood: { type: String, default: '' },
  issuesReported: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Issue' }],
  issuesSupported: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Issue' }],
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Issue' }],
  // Reputation system
  reputation: { type: Number, default: 0 },
  badges: [badgeSchema],
  // Stats cache (updated on events)
  stats: {
    issuesReportedCount: { type: Number, default: 0 },
    issuesResolvedCount: { type: Number, default: 0 },
    totalSupportGiven: { type: Number, default: 0 },
    totalSupportReceived: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 }
  },
  lastSeenAt: { type: Date, default: Date.now },
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: '' }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Badge definitions
userSchema.statics.BADGES = {
  FIRST_REPORT: { id: 'first_report', label: 'First Report', icon: '📋' },
  FIVE_REPORTS: { id: 'five_reports', label: 'Active Reporter', icon: '🗂️' },
  TEN_REPORTS: { id: 'ten_reports', label: 'Community Advocate', icon: '📣' },
  FIRST_RESOLVE: { id: 'first_resolve', label: 'Problem Solver', icon: '✅' },
  FIVE_RESOLVES: { id: 'five_resolves', label: 'Change Maker', icon: '🏆' },
  SUPPORTER: { id: 'supporter', label: 'Supporter', icon: '▲' },
  DONOR: { id: 'donor', label: 'Donor', icon: '💚' },
  VETERAN: { id: 'veteran', label: 'Veteran', icon: '⭐' }
};

module.exports = mongoose.model('User', userSchema);
