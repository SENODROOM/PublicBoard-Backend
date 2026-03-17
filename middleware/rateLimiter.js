const rateLimit = require("express-rate-limit");

// General API limiter — 200 req / 15 min per IP
exports.apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
  skip: (req) => process.env.NODE_ENV === "test",
});

// Auth routes — 20 req / 15 min (stricter to prevent brute force)
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  skip: (req) => process.env.NODE_ENV === "test",
});

// Issue creation — 10 per hour
exports.createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Issue submission limit reached. Please wait before submitting more." },
  skip: (req) => process.env.NODE_ENV === "test",
});

// Admin routes — more permissive but still rate limited
exports.adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Admin rate limit exceeded." },
  skip: (req) => process.env.NODE_ENV === "test",
});

// Password reset — very strict, 5 per hour per IP
exports.passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset attempts. Please wait 1 hour." },
  skip: (req) => process.env.NODE_ENV === "test",
});