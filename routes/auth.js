const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { sendEmail } = require("../utils/email");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();

// ── Token helpers ─────────────────────────────────────────
function signAccessToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  });
}

function userPayload(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    bio: user.bio,
    neighborhood: user.neighborhood,
    reputation: user.reputation,
    badges: user.badges,
    stats: user.stats,
  };
}

// ── POST /api/auth/register ───────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, neighborhood } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: "Name, email, and password are required" });
    if (password.length < 8)
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    if (name.trim().length < 2)
      return res.status(400).json({ message: "Name must be at least 2 characters" });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: "Email already in use" });

    // Create verification token
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const verifyTokenHash = crypto.createHash("sha256").update(verifyToken).digest("hex");

    const user = await User.create({
      name: name.trim(),
      email,
      password,
      neighborhood: neighborhood?.trim() || "",
      emailVerifyToken: verifyTokenHash,
      emailVerifyExpires: Date.now() + 24 * 60 * 60 * 1000, // 24h
    });

    await ActivityLog.create({
      actor: { userId: user._id, name: user.name, role: "user" },
      action: "user.registered",
      target: { type: "user", id: user._id.toString(), label: user.email },
      ip: req.ip,
    });

    // Send verification email
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
    await sendEmail({
      to: user.email,
      subject: "Verify your PublicBoard account",
      html: `
        <h2>Welcome to PublicBoard, ${user.name}!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <a href="${verifyUrl}" style="background:#1a1a2e;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;">Verify Email</a>
        <p>This link expires in 24 hours.</p>
        <p>If you didn't create this account, you can safely ignore this email.</p>
      `,
    });

    const token = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);

    res.status(201).json({
      token,
      refreshToken,
      user: userPayload(user),
      message: "Registration successful. Please check your email to verify your account.",
    });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "Email already in use" });
    res.status(400).json({ message: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required" });

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) return res.status(401).json({ message: "Invalid email or password" });

    if (user.isBanned)
      return res.status(403).json({ message: `Account suspended: ${user.banReason || "Contact support"}` });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ message: "Invalid email or password" });

    user.lastSeenAt = new Date();
    await user.save({ validateBeforeSave: false });

    await ActivityLog.create({
      actor: { userId: user._id, name: user.name, role: user.role },
      action: "user.login",
      target: { type: "user", id: user._id.toString(), label: user.email },
      ip: req.ip,
    });

    const token = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);

    res.json({ token, refreshToken, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ message: "Refresh token required" });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }

    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(401).json({ message: "User no longer exists" });
    if (user.isBanned) return res.status(403).json({ message: "Account suspended" });

    const token = signAccessToken(user._id);
    res.json({ token, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────
router.get("/me", protect, async (req, res) => {
  res.json({ user: userPayload(req.user) });
});

// ── PATCH /api/auth/me ────────────────────────────────────
router.patch("/me", protect, async (req, res) => {
  try {
    const allowed = ["name", "bio", "neighborhood", "avatar"];
    const update = {};
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    });
    if (update.name && update.name.trim().length < 2)
      return res.status(400).json({ message: "Name must be at least 2 characters" });

    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    }).select("-password");
    res.json({ user: userPayload(user) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── PATCH /api/auth/change-password ──────────────────────
router.patch("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: "Both current and new password required" });
    if (newPassword.length < 8)
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    if (currentPassword === newPassword)
      return res.status(400).json({ message: "New password must differ from current password" });

    const user = await User.findById(req.user._id).select("+password");
    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ message: "Current password is incorrect" });

    user.password = newPassword;
    await user.save();
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    // Always return success to prevent email enumeration
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ message: "If that email exists, a reset link has been sent." });

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    user.passwordResetToken = resetHash;
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your PublicBoard password",
      html: `
        <h2>Password Reset Request</h2>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="background:#1a1a2e;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;">Reset Password</a>
        <p>If you didn't request this, please ignore this email. Your password will not change.</p>
      `,
    });

    res.json({ message: "If that email exists, a reset link has been sent." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/reset-password ────────────────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ message: "Token and new password are required" });
    if (password.length < 8)
      return res.status(400).json({ message: "Password must be at least 8 characters" });

    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      passwordResetToken: hash,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: "Reset token is invalid or has expired" });

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({ message: "Password reset successfully. You can now log in." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/verify-email ───────────────────────────
router.post("/verify-email", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token is required" });

    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      emailVerifyToken: hash,
      emailVerifyExpires: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: "Verification token is invalid or expired" });

    user.isEmailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    user.reputation += 5; // bonus for verifying
    await user.save();

    res.json({ message: "Email verified successfully!" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;