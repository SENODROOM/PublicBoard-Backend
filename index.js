require("dotenv").config();

// ── Env validation ────────────────────────────────────────
const REQUIRED_ENV = [
  "MONGODB_URI",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "ALLOWED_ORIGINS",
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`FATAL: Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const { xss } = require("express-xss-sanitizer");
const compression = require("compression");
const morgan = require("morgan");

const issueRoutes = require("./routes/issues");
const authRoutes = require("./routes/auth");
const donationRoutes = require("./routes/donations");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");
const announcementRoutes = require("./routes/announcements");
const notificationRoutes = require("./routes/notifications");
const seedAdmin = require("./utils/seedAdmin");
const { apiLimiter, authLimiter } = require("./middleware/rateLimiter");

const app = express();

// ── Security headers ──────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);

// ── CORS ──────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",").map((o) =>
  o.trim()
);
app.use(
  cors({
    origin: (origin, cb) => {
      // allow server-to-server (no origin) only in dev
      if (!origin && process.env.NODE_ENV !== "production") return cb(null, true);
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin '${origin}' not allowed by CORS`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Request parsing ───────────────────────────────────────
app.use(express.json({ limit: "1mb" }));          // reduced from 10mb — prevent large payload attacks
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Input sanitization ────────────────────────────────────
app.use(mongoSanitize());   // strip $ and . from keys — prevents NoSQL injection
app.use(xss());             // sanitize XSS in request body/query/params

// ── Compression ───────────────────────────────────────────
app.use(compression());

// ── Logging ───────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  app.use(morgan("combined"));
} else {
  app.use(morgan("dev"));
}

// ── Trust proxy (needed for accurate IP behind Nginx/Heroku/Railway) ─────────
app.set("trust proxy", 1);

// ── Rate limiting ─────────────────────────────────────────
app.use("/api/", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/refresh", authLimiter);

// ── SSE client store ──────────────────────────────────────
const sseClients = new Set();
app.locals.sseClients = sseClients;

// ── Routes ────────────────────────────────────────────────
app.use("/api/issues", issueRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/notifications", notificationRoutes);

// ── Stripe webhook (raw body — must be BEFORE express.json for this route) ───
// NOTE: Register this route in donations.js using express.raw() on the specific path
app.use("/api/webhook", require("./routes/webhook"));

// ── Real-time SSE ─────────────────────────────────────────
app.get("/api/events", (req, res) => {
  // Verify optional token
  const token = req.query.token;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering
  res.flushHeaders();

  const client = { res, id: Date.now(), token };
  sseClients.add(client);
  res.write(`data: ${JSON.stringify({ type: "connected", id: client.id })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch (_) {}
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

// ── Health check ──────────────────────────────────────────
app.get("/api/health", (req, res) =>
  res.json({
    status: "ok",
    env: process.env.NODE_ENV,
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    uptime: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  })
);

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ message: `${req.method} ${req.path} not found` })
);

// ── Global error handler ──────────────────────────────────
app.use((err, req, res, next) => {
  // Don't leak stack traces in production
  const isDev = process.env.NODE_ENV !== "production";
  console.error("[Error]", err.message, isDev ? err.stack : "");

  if (err.name === "ValidationError") {
    return res.status(400).json({
      message: Object.values(err.errors).map((e) => e.message).join(", "),
    });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(400).json({ message: `${field} already in use` });
  }

  res.status(err.status || 500).json({
    message: isDev ? err.message : "Internal server error",
    ...(isDev && { stack: err.stack }),
  });
});

// ── DB → seed → listen ───────────────────────────────────
const PORT = parseInt(process.env.PORT || "5000", 10);

mongoose
  .connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  })
  .then(async () => {
    console.log("✅ MongoDB connected");
    await seedAdmin();
    const server = app.listen(PORT, () =>
      console.log(`🚀 PublicBoard API on port ${PORT} [${process.env.NODE_ENV}]`)
    );

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n${signal} received — shutting down gracefully`);
      server.close(() => {
        mongoose.connection.close(false, () => {
          console.log("MongoDB connection closed");
          process.exit(0);
        });
      });
      setTimeout(() => process.exit(1), 10000);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

mongoose.connection.on("disconnected", () => console.warn("⚠️  MongoDB disconnected"));
mongoose.connection.on("reconnected", () => console.log("✅ MongoDB reconnected"));

module.exports = app; // for testing