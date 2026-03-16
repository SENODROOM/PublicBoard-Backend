require("dotenv").config();

// Validate critical env vars on startup
const REQUIRED_ENV = ["MONGODB_URI", "JWT_SECRET"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `FATAL: Missing required environment variables: ${missing.join(", ")}`,
  );
  console.error("Copy .env.example to .env and fill in the values.");
  process.exit(1);
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");

const issueRoutes = require("./routes/issues");
const authRoutes = require("./routes/auth");
const donationRoutes = require("./routes/donations");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");
const announcementRoutes = require("./routes/announcements");
const notificationRoutes = require("./routes/notifications");
const seedAdmin = require("./utils/seedAdmin");
const { apiLimiter } = require("./middleware/rateLimiter");

const app = express();

// ── Security ─────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false, // allow frontend to connect freely in dev
  }),
);

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || "http://localhost:3000"
).split(",");
app.use(
  cors({
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== "production"
      )
        return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Rate limiting ─────────────────────────────────────────
app.use("/api/", apiLimiter);

// ── SSE clients store ────────────────────────────────────
// Simple in-memory SSE broadcast for real-time updates
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

// ── Real-time SSE endpoint ───────────────────────────────
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.flushHeaders();

  const client = { res, id: Date.now() };
  sseClients.add(client);
  res.write(
    `data: ${JSON.stringify({ type: "connected", id: client.id })}\n\n`,
  );

  // Heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

// ── Health check ─────────────────────────────────────────
app.get("/api/health", (req, res) =>
  res.json({
    status: "ok",
    message: "PublicBoard API running",
    env: process.env.NODE_ENV || "development",
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  }),
);

// ── 404 handler ──────────────────────────────────────────
app.use((req, res) =>
  res
    .status(404)
    .json({ message: `Route ${req.method} ${req.path} not found` }),
);

// ── Error handler ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Error]", err.message);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ── DB connect → seed → listen ───────────────────────────
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  })
  .then(async () => {
    console.log("✅ MongoDB connected");
    await seedAdmin();
    app.listen(PORT, () =>
      console.log(`🚀 PublicBoard API running on port ${PORT}`),
    );
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

mongoose.connection.on("disconnected", () =>
  console.warn("⚠️  MongoDB disconnected"),
);
mongoose.connection.on("reconnected", () =>
  console.log("✅ MongoDB reconnected"),
);
