const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET not set in environment variables");
  process.exit(1);
}

// Attach user to req.user — always fetches fresh from DB so role is current
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ message: "Not authorized — no token" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user)
      return res.status(401).json({ message: "User no longer exists" });

    // Check if user is banned
    if (user.isBanned)
      return res
        .status(403)
        .json({
          message: `Account suspended: ${user.banReason || "Contact support"}`,
        });

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ message: "Token invalid or expired" });
  }
};

// Optional auth — attaches user if token present, doesn't block if not
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (user && !user.isBanned) req.user = user;
  } catch (_) {}
  next();
};

// Must be used AFTER protect
const adminOnly = (req, res, next) => {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "moderator"))
    return res.status(403).json({ message: "Admin access required" });
  next();
};

const superAdminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin")
    return res.status(403).json({ message: "Super-admin access required" });
  next();
};

module.exports = { protect, optionalAuth, adminOnly, superAdminOnly };
