/**
 * Admin Routes Tests
 *
 * All endpoints are protected by protect + adminOnly.
 * Tokens are signed directly — no login roundtrip needed.
 */

const request    = require('supertest');
const mongoose   = require('mongoose');
const { connectDB, disconnectDB, clearDB, signToken, buildApp } = require('./helpers');

const adminRouter = require('../routes/admin');
const User        = require('../models/User');
const Issue       = require('../models/Issue');
const Donation    = require('../models/Donation');
const ActivityLog = require('../models/ActivityLog');
const Announcement = require('../models/Announcement');

const app = buildApp('/api/admin', adminRouter);

// ── Seed users ────────────────────────────────────────────
let adminUser, regularUser, adminToken, userToken;

beforeAll(async () => { await connectDB(); });
afterAll(async () => { await disconnectDB(); });

beforeEach(async () => {
  await clearDB();

  adminUser = await User.create({
    name: 'Admin',
    email: 'admin@test.com',
    password: 'pass12345',
    role: 'admin',
  });
  regularUser = await User.create({
    name: 'Regular',
    email: 'user@test.com',
    password: 'pass12345',
    role: 'user',
  });

  adminToken = signToken({ id: adminUser._id });
  userToken  = signToken({ id: regularUser._id });
});

// ── Auth guard (all routes) ───────────────────────────────
describe('Admin routes — auth guard', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a regular user token', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/overview ───────────────────────────────
describe('GET /api/admin/overview', () => {
  beforeEach(async () => {
    await Issue.create([
      { title: 'Open Issue',     description: 'desc',   category: 'Infrastructure', location: 'loc', status: 'Open',        reporter: { name: 'A', email: 'a@t.com' }, priority: 'High'   },
      { title: 'Resolved Issue', description: 'desc',   category: 'Safety',         location: 'loc', status: 'Resolved',    reporter: { name: 'B', email: 'b@t.com' }, priority: 'Low'    },
      { title: 'InProg Issue',   description: 'desc',   category: 'Environment',    location: 'loc', status: 'In Progress', reporter: { name: 'C', email: 'c@t.com' }, priority: 'Medium' },
    ]);
    await Donation.create([
      { donor: { name: 'D', email: 'd@t.com' }, amount: 50, status: 'completed', isAnonymous: false },
      { donor: { name: 'E', email: 'e@t.com' }, amount: 30, status: 'pending',   isAnonymous: false },
    ]);
  });

  it('returns correct issue counts', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.open).toBe(1);
    expect(res.body.resolved).toBe(1);
    expect(res.body.inProgress).toBe(1);
  });

  it('returns user count', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.totalUsers).toBe(2); // adminUser + regularUser
  });

  it('sums only completed donations', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.totalDonations).toBe(50); // only the completed one
  });

  it('includes priorityBreakdown and recentActivity arrays', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Array.isArray(res.body.priorityBreakdown)).toBe(true);
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
  });
});

// ── GET /api/admin/issues ─────────────────────────────────
describe('GET /api/admin/issues', () => {
  beforeEach(async () => {
    await Issue.create([
      { title: 'Open Infra',    description: 'desc', category: 'Infrastructure', location: 'Oak Ave', status: 'Open',     priority: 'High',   reporter: { name: 'A', email: 'a@t.com' } },
      { title: 'Resolved Safety', description: 'desc', category: 'Safety',      location: 'Main St', status: 'Resolved', priority: 'Low',    reporter: { name: 'B', email: 'b@t.com' } },
      { title: 'InProg Env',    description: 'desc', category: 'Environment',   location: 'Park',    status: 'In Progress', priority: 'Medium', reporter: { name: 'C', email: 'c@t.com' } },
    ]);
  });

  it('returns all issues with pagination meta', async () => {
    const res = await request(app)
      .get('/api/admin/issues')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('filters by status', async () => {
    const res = await request(app)
      .get('/api/admin/issues?status=Resolved')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.issues.every(i => i.status === 'Resolved')).toBe(true);
    expect(res.body.total).toBe(1);
  });

  it('filters by category', async () => {
    const res = await request(app)
      .get('/api/admin/issues?category=Safety')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.total).toBe(1);
    expect(res.body.issues[0].category).toBe('Safety');
  });

  it('filters by priority', async () => {
    const res = await request(app)
      .get('/api/admin/issues?priority=High')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.total).toBe(1);
  });

  it('searches by title', async () => {
    const res = await request(app)
      .get('/api/admin/issues?search=Open+Infra')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.total).toBe(1);
    expect(res.body.issues[0].title).toBe('Open Infra');
  });

  it('respects pagination params', async () => {
    const res = await request(app)
      .get('/api/admin/issues?limit=2&page=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.issues).toHaveLength(2);
    expect(res.body.pages).toBe(2);
  });
});

// ── PATCH /api/admin/issues/:id ───────────────────────────
describe('PATCH /api/admin/issues/:id', () => {
  let issue;

  beforeEach(async () => {
    issue = await Issue.create({
      title: 'Test Issue', description: 'desc', category: 'Infrastructure',
      location: 'loc', status: 'Open', priority: 'Medium',
      reporter: { name: 'Rep', email: 'rep@t.com' },
    });
  });

  it('updates issue status and logs the change', async () => {
    const res = await request(app)
      .patch(`/api/admin/issues/${issue._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'In Progress' });

    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('In Progress');

    const log = await ActivityLog.findOne({ action: 'issue.status_changed' });
    expect(log).not.toBeNull();
    expect(log.meta.from).toBe('Open');
    expect(log.meta.to).toBe('In Progress');
  });

  it('sets resolvedAt and resolutionTimeHours when marking Resolved', async () => {
    const res = await request(app)
      .patch(`/api/admin/issues/${issue._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Resolved' });

    expect(res.body.issue.resolvedAt).toBeTruthy();
    expect(res.body.issue.resolutionTimeHours).toBeGreaterThanOrEqual(0);
  });

  it('updates priority without changing status', async () => {
    const res = await request(app)
      .patch(`/api/admin/issues/${issue._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priority: 'Critical' });

    expect(res.status).toBe(200);
    expect(res.body.issue.priority).toBe('Critical');
    expect(res.body.issue.status).toBe('Open'); // unchanged
  });

  it('locks an issue', async () => {
    const res = await request(app)
      .patch(`/api/admin/issues/${issue._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isLocked: true });

    expect(res.body.issue.isLocked).toBe(true);
  });

  it('returns 404 for unknown issue id', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`/api/admin/issues/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Resolved' });

    expect(res.status).toBe(404);
  });
});

// ── POST /api/admin/issues/bulk ───────────────────────────
describe('POST /api/admin/issues/bulk', () => {
  let ids;

  beforeEach(async () => {
    const issues = await Issue.create([
      { title: 'A', description: 'desc', category: 'Infrastructure', location: 'l', status: 'Open', reporter: { name: 'x', email: 'x@t.com' } },
      { title: 'B', description: 'desc', category: 'Safety',         location: 'l', status: 'Open', reporter: { name: 'y', email: 'y@t.com' } },
      { title: 'C', description: 'desc', category: 'Environment',    location: 'l', status: 'Open', reporter: { name: 'z', email: 'z@t.com' } },
    ]);
    ids = issues.map(i => i._id.toString());
  });

  it('bulk updates status for multiple issues', async () => {
    const res = await request(app)
      .post('/api/admin/issues/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: ids.slice(0, 2), action: 'status', value: 'Resolved' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const updated = await Issue.find({ _id: { $in: ids.slice(0, 2) } });
    expect(updated.every(i => i.status === 'Resolved')).toBe(true);
  });

  it('bulk deletes multiple issues', async () => {
    const res = await request(app)
      .post('/api/admin/issues/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids, action: 'delete' });

    expect(res.status).toBe(200);
    const remaining = await Issue.countDocuments();
    expect(remaining).toBe(0);
  });

  it('logs the bulk action', async () => {
    await request(app)
      .post('/api/admin/issues/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids, action: 'status', value: 'In Progress' });

    const log = await ActivityLog.findOne({ action: 'admin.bulk_status' });
    expect(log).not.toBeNull();
    expect(log.meta.count).toBe(3);
  });

  it('returns 400 when no IDs provided', async () => {
    const res = await request(app)
      .post('/api/admin/issues/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [], action: 'status', value: 'Resolved' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no ids/i);
  });

  it('returns 400 for unknown action', async () => {
    const res = await request(app)
      .post('/api/admin/issues/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids, action: 'nuke', value: 'whatever' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unknown action/i);
  });
});

// ── GET /api/admin/users ──────────────────────────────────
describe('GET /api/admin/users', () => {
  beforeEach(async () => {
    await User.create([
      { name: 'Alice Admin', email: 'alice@test.com', password: 'pass12345', role: 'admin' },
      { name: 'Bob User',    email: 'bob@test.com',   password: 'pass12345', role: 'user'  },
    ]);
  });

  it('returns all users with pagination', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4); // 2 from setup + 2 created here
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('filters by role', async () => {
    const res = await request(app)
      .get('/api/admin/users?role=admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.users.every(u => u.role === 'admin')).toBe(true);
  });

  it('searches by name', async () => {
    const res = await request(app)
      .get('/api/admin/users?search=Alice')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.users.some(u => u.name === 'Alice Admin')).toBe(true);
  });

  it('searches by email', async () => {
    const res = await request(app)
      .get('/api/admin/users?search=bob@test.com')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.users.some(u => u.email === 'bob@test.com')).toBe(true);
  });

  it('never returns password fields', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    res.body.users.forEach(u => {
      expect(u.password).toBeUndefined();
    });
  });
});

// ── GET /api/admin/users/:id ──────────────────────────────
describe('GET /api/admin/users/:id', () => {
  it('returns full user profile with issue counts', async () => {
    await Issue.create({
      title: 'Rep Issue', description: 'desc', category: 'Infrastructure',
      location: 'loc', reporter: { name: regularUser.name, email: regularUser.email, userId: regularUser._id },
    });

    const res = await request(app)
      .get(`/api/admin/users/${regularUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Regular');
    expect(res.body.user.reportedCount).toBe(1);
    expect(res.body.user.password).toBeUndefined();
  });

  it('returns 404 for unknown user id', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/admin/users/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/admin/users/:id ────────────────────────────
describe('PATCH /api/admin/users/:id', () => {
  it('promotes a user to admin', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${regularUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  it('demotes an admin to regular user', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${adminUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('user');
  });

  it('bans a user with a reason', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${regularUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isBanned: true, banReason: 'Spam' });

    expect(res.status).toBe(200);
    expect(res.body.user.isBanned).toBe(true);
    expect(res.body.user.banReason).toBe('Spam');
  });

  it('unbans a user', async () => {
    await User.findByIdAndUpdate(regularUser._id, { isBanned: true, banReason: 'Spam' });

    const res = await request(app)
      .patch(`/api/admin/users/${regularUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isBanned: false });

    expect(res.status).toBe(200);
    expect(res.body.user.isBanned).toBe(false);
  });

  it('logs the role change to ActivityLog', async () => {
    await request(app)
      .patch(`/api/admin/users/${regularUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'moderator' });

    const log = await ActivityLog.findOne({ action: 'user.role_changed' });
    expect(log).not.toBeNull();
    expect(log.meta.role).toBe('moderator');
  });
});

// ── GET /api/admin/activity ───────────────────────────────
describe('GET /api/admin/activity', () => {
  beforeEach(async () => {
    await ActivityLog.create([
      { actor: { userId: adminUser._id, name: 'Admin', role: 'admin' }, action: 'issue.created',       target: { type: 'issue',  id: 'x', label: 'Issue A' } },
      { actor: { userId: adminUser._id, name: 'Admin', role: 'admin' }, action: 'user.role_changed',   target: { type: 'user',   id: 'y', label: 'User B'  } },
      { actor: { userId: regularUser._id, name: 'Regular', role: 'user' }, action: 'issue.commented', target: { type: 'issue',  id: 'z', label: 'Issue C' } },
    ]);
  });

  it('returns activity logs with pagination', async () => {
    const res = await request(app)
      .get('/api/admin/activity')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  it('filters by action type', async () => {
    const res = await request(app)
      .get('/api/admin/activity?action=user.role_changed')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.total).toBe(1);
    expect(res.body.logs[0].action).toBe('user.role_changed');
  });

  it('filters by actorId', async () => {
    const res = await request(app)
      .get(`/api/admin/activity?actorId=${regularUser._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.total).toBe(1);
    expect(res.body.logs[0].actor.name).toBe('Regular');
  });

  it('returns logs in descending order (newest first)', async () => {
    const res = await request(app)
      .get('/api/admin/activity')
      .set('Authorization', `Bearer ${adminToken}`);

    const times = res.body.logs.map(l => new Date(l.createdAt).getTime());
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
    }
  });
});

// ── GET /api/admin/donations/export ──────────────────────
describe('GET /api/admin/donations/export', () => {
  beforeEach(async () => {
    await Donation.create([
      { donor: { name: 'Alice', email: 'alice@t.com' }, amount: 50, status: 'completed', isAnonymous: false },
      { donor: { name: 'Bob',   email: 'bob@t.com'   }, amount: 20, status: 'pending',   isAnonymous: false },
    ]);
  });

  it('returns a CSV file with correct content-type header', async () => {
    const res = await request(app)
      .get('/api/admin/donations/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('sets content-disposition to attachment', async () => {
    const res = await request(app)
      .get('/api/admin/donations/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/donations\.csv/);
  });

  it('includes all donations in the CSV regardless of status', async () => {
    const res = await request(app)
      .get('/api/admin/donations/export')
      .set('Authorization', `Bearer ${adminToken}`);

    const lines = res.text.split('\n');
    // Header + 2 data rows
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('returns 403 for regular users', async () => {
    const res = await request(app)
      .get('/api/admin/donations/export')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(403);
  });
});