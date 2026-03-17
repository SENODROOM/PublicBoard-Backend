const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { connectDB, disconnectDB, clearDB, signToken } = require('./helpers');
const User = require('../models/User');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

// Simple test route
function makeApp() {
  const app = express();
  app.use(express.json());

  app.get('/protected', protect, (req, res) => res.json({ userId: req.user._id, role: req.user.role }));
  app.get('/admin-only', protect, adminOnly, (req, res) => res.json({ ok: true }));
  app.get('/optional', optionalAuth, (req, res) => res.json({ userId: req.user?._id ?? null }));

  return app;
}

let app;
let regularUser;
let adminUser;
let bannedUser;

beforeAll(async () => {
  await connectDB();
  app = makeApp();

  regularUser = await User.create({ name: 'Alice', email: 'alice@test.com', password: 'password123', role: 'user' });
  adminUser   = await User.create({ name: 'Admin', email: 'admin@test.com', password: 'password123', role: 'admin' });
  bannedUser  = await User.create({ name: 'Banned', email: 'banned@test.com', password: 'password123', isBanned: true, banReason: 'spam' });
});

afterAll(async () => { await disconnectDB(); });

// ── protect middleware ────────────────────────────────────

describe('protect middleware', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no token/i);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('returns 401 when the user no longer exists', async () => {
    const ghostId = new mongoose.Types.ObjectId();
    const token = signToken({ id: ghostId });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no longer exists/i);
  });

  it('returns 403 for a banned user', async () => {
    const token = signToken({ id: bannedUser._id });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/suspended/i);
  });

  it('attaches req.user for a valid token', async () => {
    const token = signToken({ id: regularUser._id });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(regularUser._id.toString());
    expect(res.body.role).toBe('user');
  });

  it('returns 401 for an expired token', async () => {
    const token = signToken({ id: regularUser._id }, '-1s'); // already expired
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

// ── adminOnly middleware ──────────────────────────────────

describe('adminOnly middleware', () => {
  it('returns 403 for a regular user', async () => {
    const token = signToken({ id: regularUser._id });
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin access required/i);
  });

  it('allows admin users through', async () => {
    const token = signToken({ id: adminUser._id });
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── optionalAuth middleware ───────────────────────────────

describe('optionalAuth middleware', () => {
  it('continues without attaching user when no token provided', async () => {
    const res = await request(app).get('/optional');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
  });

  it('attaches user when a valid token is provided', async () => {
    const token = signToken({ id: regularUser._id });
    const res = await request(app).get('/optional').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(regularUser._id.toString());
  });

  it('continues without attaching user for invalid token (no 401)', async () => {
    const res = await request(app).get('/optional').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
  });
});
