const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const { protect } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || JWT_SECRET + "_refresh";

const signAccess = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: "15m" });
const signRefresh = (id) =>
  jwt.sign({ id }, JWT_REFRESH_SECRET, { expiresIn: "30d" });

const userPayload = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  avatar: u.avatar,
  bio: u.bio,
  reputation: u.reputation,
  badges: u.badges,
  stats: u.stats,
  neighborhood: u.neighborhood,
});

// ── Register ──────────────────────────────────────────────
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { name, email, password, neighborhood } = req.body;
    if (!name || !email || !password)
      return res
        .status(400)
        .json({ message: "Name, email and password are required" });
    if (password.length < 8)
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });

    if (email.toLowerCase() === (process.env.ADMIN_EMAIL || "").toLowerCase())
      return res
        .status(400)
        .json({ message: "This email is reserved for the system admin." });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists)
      return res.status(400).json({ message: "Email already in use" });

    const user = await User.create({
      name,
      email,
      password,
      neighborhood: neighborhood || "",
    });

    await ActivityLog.create({
      actor: { userId: user._id, name: user.name, role: "user" },
      action: "user.registered",
      target: { type: "user", id: user._id.toString(), label: user.name },
    });

    const token = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    res.status(201).json({ token, refreshToken, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Login ─────────────────────────────────────────────────
router.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and password are required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: "Invalid email or password" });

    if (user.isBanned)
      return res
        .status(403)
        .json({
          message: `Account suspended: ${user.banReason || "Contact support"}`,
        });

    // Update last seen
    user.lastSeenAt = new Date();
    await user.save();

    await ActivityLog.create({
      actor: { userId: user._id, name: user.name, role: user.role },
      action: "user.login",
      target: { type: "user", id: user._id.toString(), label: user.name },
    });

    const token = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    res.json({ token, refreshToken, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Refresh token ─────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(401).json({ message: "Refresh token required" });
  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.isBanned)
      return res.status(403).json({ message: "Account suspended" });
    const token = signAccess(user._id);
    res.json({ token, user: userPayload(user) });
  } catch (_) {
    res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});

// ── Get current user ──────────────────────────────────────
router.get("/me", protect, async (req, res) => {
  // req.user is the full mongoose doc from protect middleware
  res.json({ user: userPayload(req.user) });
});

// ── Update profile ────────────────────────────────────────
router.patch("/me", protect, async (req, res) => {
  try {
    const allowed = ["name", "bio", "neighborhood", "avatar"];
    const update = {};
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    });

    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    }).select("-password");
    res.json({ user: userPayload(user) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── Change password ───────────────────────────────────────
router.patch("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res
        .status(400)
        .json({ message: "Both current and new password required" });
    if (newPassword.length < 8)
      return res
        .status(400)
        .json({ message: "New password must be at least 8 characters" });

    const user = await User.findById(req.user._id);
    const valid = await user.comparePassword(currentPassword);
    if (!valid)
      return res.status(401).json({ message: "Current password is incorrect" });

    user.password = newPassword;
    await user.save();
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
