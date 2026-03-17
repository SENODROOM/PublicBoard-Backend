const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const badgeSchema = new mongoose.Schema(
  {
    id: String,
    label: String,
    icon: String,
    earnedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email address"],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ["user", "moderator", "admin"], default: "user" },
    avatar: { type: String, default: "" },
    bio: { type: String, maxlength: 200, default: "" },
    neighborhood: { type: String, default: "", maxlength: 100 },

    // References
    issuesReported: [{ type: mongoose.Schema.Types.ObjectId, ref: "Issue" }],
    issuesSupported: [{ type: mongoose.Schema.Types.ObjectId, ref: "Issue" }],
    bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Issue" }],

    // Reputation
    reputation: { type: Number, default: 0 },
    badges: [badgeSchema],

    // Stats cache (updated on events)
    stats: {
      issuesReportedCount: { type: Number, default: 0 },
      issuesResolvedCount: { type: Number, default: 0 },
      totalSupportGiven: { type: Number, default: 0 },
      totalSupportReceived: { type: Number, default: 0 },
      commentsCount: { type: Number, default: 0 },
    },

    lastSeenAt: { type: Date, default: Date.now },

    // Account status
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: "" },

    // Email verification
    isEmailVerified: { type: Boolean, default: false },
    emailVerifyToken: { type: String, select: false },
    emailVerifyExpires: { type: Date, select: false },

    // Password reset
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ reputation: -1 });

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Badge definitions
userSchema.statics.BADGES = {
  FIRST_REPORT: { id: "first_report", label: "First Report", icon: "📋" },
  FIVE_REPORTS: { id: "five_reports", label: "Active Reporter", icon: "🗂️" },
  TEN_REPORTS: { id: "ten_reports", label: "Community Advocate", icon: "📣" },
  FIRST_RESOLVE: { id: "first_resolve", label: "Problem Solver", icon: "✅" },
  FIVE_RESOLVES: { id: "five_resolves", label: "Change Maker", icon: "🏆" },
  SUPPORTER: { id: "supporter", label: "Supporter", icon: "▲" },
  DONOR: { id: "donor", label: "Donor", icon: "💚" },
  VETERAN: { id: "veteran", label: "Veteran", icon: "⭐" },
  EMAIL_VERIFIED: { id: "email_verified", label: "Verified", icon: "✓" },
};

module.exports = mongoose.model("User", userSchema);