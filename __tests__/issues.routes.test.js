const request = require('supertest');
const { connectDB, disconnectDB, clearDB, signToken, buildApp } = require('./helpers');
const issuesRouter = require('../routes/issues');
const User  = require('../models/User');
const Issue = require('../models/Issue');

const app = buildApp('/api/issues', issuesRouter);

let user, adminUser, userToken, adminToken;

beforeAll(async () => { await connectDB(); });
afterAll(async () => { await disconnectDB(); });
beforeEach(async () => {
  await clearDB();
  user      = await User.create({ name: 'Reporter', email: 'rep@test.com',   password: 'pass12345', role: 'user'  });
  adminUser = await User.create({ name: 'Admin',    email: 'admin@test.com', password: 'pass12345', role: 'admin' });
  userToken  = signToken({ id: user._id });
  adminToken = signToken({ id: adminUser._id });
});

function issuePayload(overrides = {}) {
  return {
    title: 'Broken streetlight on Oak Ave',
    description: 'Three lights out for two weeks, safety hazard at night.',
    category: 'Infrastructure',
    location: 'Oak Ave & 5th St',
    neighborhood: 'Riverside',
    priority: 'High',
    tags: ['streetlight', 'safety'],
    reporter: { name: user.name, email: user.email, userId: user._id },
    ...overrides,
  };
}

// ── GET /api/issues ───────────────────────────────────────

describe('GET /api/issues', () => {
  beforeEach(async () => {
    await Issue.create([
      { ...issuePayload(), status: 'Open' },
      { ...issuePayload({ title: 'Pothole on Main St', category: 'Infrastructure', status: 'Resolved', location: 'Main St' }) },
      { ...issuePayload({ title: 'Park debris', category: 'Environment', status: 'Open', location: 'Riverside Park' }) },
    ]);
  });

  it('returns all issues with pagination meta', async () => {
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.total).toBe(3);
    expect(typeof res.body.pages).toBe('number');
  });

  it('filters by status', async () => {
    const res = await request(app).get('/api/issues?status=Resolved');
    expect(res.status).toBe(200);
    expect(res.body.issues.every(i => i.status === 'Resolved')).toBe(true);
    expect(res.body.total).toBe(1);
  });

  it('filters by category', async () => {
    const res = await request(app).get('/api/issues?category=Environment');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.issues[0].category).toBe('Environment');
  });

  it('respects limit and page params', async () => {
    const res = await request(app).get('/api/issues?limit=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(2);
  });
});

// ── POST /api/issues ──────────────────────────────────────

describe('POST /api/issues', () => {
  it('creates an issue without auth (public endpoint)', async () => {
    const res = await request(app).post('/api/issues').send(issuePayload());
    expect(res.status).toBe(201);
    expect(res.body.issue.title).toBe('Broken streetlight on Oak Ave');
    expect(res.body.issue.status).toBe('Open');
  });

  it('creates issue and awards reputation when authenticated', async () => {
    const res = await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${userToken}`)
      .send(issuePayload());

    expect(res.status).toBe(201);
    const updatedUser = await User.findById(user._id);
    expect(updatedUser.reputation).toBe(10);
    expect(updatedUser.stats.issuesReportedCount).toBe(1);
  });

  it('awards first_report badge on first issue', async () => {
    await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${userToken}`)
      .send(issuePayload());

    const updatedUser = await User.findById(user._id);
    expect(updatedUser.badges.some(b => b.id === 'first_report')).toBe(true);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/api/issues').send({ title: 'No category or location' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/issues/:id ───────────────────────────────────

describe('GET /api/issues/:id', () => {
  it('returns the issue and increments view count', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app).get(`/api/issues/${issue._id}`);
    expect(res.status).toBe(200);
    expect(res.body.issue._id).toBe(issue._id.toString());

    const updated = await Issue.findById(issue._id);
    expect(updated.views).toBe(1);
  });

  it('returns 404 for unknown id', async () => {
    const fakeId = new (require('mongoose').Types.ObjectId)();
    const res = await request(app).get(`/api/issues/${fakeId}`);
    expect(res.status).toBe(404);
  });
});

// ── POST /api/issues/:id/support ─────────────────────────

describe('POST /api/issues/:id/support', () => {
  it('increments support count on first vote', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app)
      .post(`/api/issues/${issue._id}/support`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.supported).toBe(true);
    expect(res.body.issue.supportCount).toBe(1);
  });

  it('decrements support count on second vote (toggle)', async () => {
    const issue = await Issue.create(issuePayload());
    await request(app).post(`/api/issues/${issue._id}/support`).set('Authorization', `Bearer ${userToken}`);
    const res = await request(app).post(`/api/issues/${issue._id}/support`).set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.supported).toBe(false);
    expect(res.body.issue.supportCount).toBe(0);
  });

  it('returns 401 without auth', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app).post(`/api/issues/${issue._id}/support`);
    expect(res.status).toBe(401);
  });
});

// ── POST /api/issues/:id/comments ────────────────────────

describe('POST /api/issues/:id/comments', () => {
  it('adds a comment when authenticated', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app)
      .post(`/api/issues/${issue._id}/comments`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'This is urgent, please fix asap!' });

    expect(res.status).toBe(201);
    expect(res.body.issue.comments).toHaveLength(1);
    expect(res.body.issue.comments[0].text).toBe('This is urgent, please fix asap!');
  });

  it('rejects empty comment text', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app)
      .post(`/api/issues/${issue._id}/comments`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: '   ' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app).post(`/api/issues/${issue._id}/comments`).send({ text: 'hi' });
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/issues/:id/status ─────────────────────────

describe('PATCH /api/issues/:id/status', () => {
  it('allows reporter to update status', async () => {
    const issue = await Issue.create({
      ...issuePayload(),
      reporter: { name: user.name, email: user.email, userId: user._id },
    });
    const res = await request(app)
      .patch(`/api/issues/${issue._id}/status`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ status: 'In Progress', message: 'Working on it' });

    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('In Progress');
    expect(res.body.issue.updates).toHaveLength(1);
  });

  it('sets resolutionTimeHours when resolved', async () => {
    const issue = await Issue.create({
      ...issuePayload(),
      reporter: { name: user.name, email: user.email, userId: user._id },
    });
    const res = await request(app)
      .patch(`/api/issues/${issue._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Resolved' });

    expect(res.status).toBe(200);
    expect(res.body.issue.resolutionTimeHours).toBeGreaterThanOrEqual(0);
  });

  it('returns 403 when a non-reporter, non-admin tries to update status', async () => {
    const otherUser  = await User.create({ name: 'Other', email: 'other@test.com', password: 'pass12345' });
    const otherToken = signToken({ id: otherUser._id });
    const issue = await Issue.create(issuePayload());

    const res = await request(app)
      .patch(`/api/issues/${issue._id}/status`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'Resolved' });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/issues/:id ────────────────────────────────

describe('DELETE /api/issues/:id', () => {
  it('allows admin to delete an issue', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app)
      .delete(`/api/issues/${issue._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const check = await Issue.findById(issue._id);
    expect(check).toBeNull();
  });

  it('returns 403 for a regular user', async () => {
    const issue = await Issue.create(issuePayload());
    const res = await request(app)
      .delete(`/api/issues/${issue._id}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(403);
  });
});
