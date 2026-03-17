const request = require('supertest');
const { connectDB, disconnectDB, clearDB, signToken, buildApp } = require('./helpers');
const authRouter = require('../routes/auth');
const User = require('../models/User');

const app = buildApp('/api/auth', authRouter);

beforeAll(async () => { await connectDB(); });
afterAll(async () => { await disconnectDB(); });
beforeEach(async () => { await clearDB(); });

// ── POST /api/auth/register ────────────────────────────────

describe('POST /api/auth/register', () => {
  it('creates a new user and returns token + user payload', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Jane', email: 'jane@test.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe('jane@test.com');
    expect(res.body.user.role).toBe('user');
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejects duplicate email', async () => {
    await User.create({ name: 'Existing', email: 'dup@test.com', password: 'pass12345' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New', email: 'dup@test.com', password: 'pass12345' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already in use/i);
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Short', email: 'short@test.com', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/i);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'No email' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/login ──────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await User.create({ name: 'Bob', email: 'bob@test.com', password: 'correctpass1' });
  });

  it('returns token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob@test.com', password: 'correctpass1' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe('bob@test.com');
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob@test.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid/i);
  });

  it('rejects unknown email with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.com', password: 'anypassword' });

    expect(res.status).toBe(401);
  });

  it('rejects missing body fields with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'bob@test.com' });
    expect(res.status).toBe(400);
  });

  it('returns 403 for banned users', async () => {
    await User.create({ name: 'Banned', email: 'banned@test.com', password: 'pass12345', isBanned: true, banReason: 'TOS' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'banned@test.com', password: 'pass12345' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/suspended/i);
  });
});

// ── POST /api/auth/refresh ────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('returns a new access token for a valid refresh token', async () => {
    const user = await User.create({ name: 'Refresh', email: 'refresh@test.com', password: 'pass12345' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'refresh@test.com', password: 'pass12345' });

    const refreshToken = loginRes.body.refreshToken;
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('refresh@test.com');
  });

  it('returns 401 for a garbage refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'garbage' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when no refresh token provided', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(401);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns current user for valid token', async () => {
    const user = await User.create({ name: 'Me', email: 'me@test.com', password: 'pass12345' });
    const token = signToken({ id: user._id });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@test.com');
    expect(res.body.user.password).toBeUndefined();
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/auth/change-password ──────────────────────

describe('PATCH /api/auth/change-password', () => {
  it('updates password successfully', async () => {
    const user = await User.create({ name: 'PwdUser', email: 'pwd@test.com', password: 'oldpassword1' });
    const token = signToken({ id: user._id });

    const res = await request(app)
      .patch('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/updated/i);

    // Verify new password works
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pwd@test.com', password: 'newpassword1' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects wrong current password', async () => {
    const user = await User.create({ name: 'PwdUser2', email: 'pwd2@test.com', password: 'rightpass12' });
    const token = signToken({ id: user._id });

    const res = await request(app)
      .patch('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpassword1' });

    expect(res.status).toBe(401);
  });

  it('rejects new passwords shorter than 8 chars', async () => {
    const user = await User.create({ name: 'PwdUser3', email: 'pwd3@test.com', password: 'goodpass12' });
    const token = signToken({ id: user._id });

    const res = await request(app)
      .patch('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'goodpass12', newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/i);
  });
});
