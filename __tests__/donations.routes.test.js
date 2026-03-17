const request = require('supertest');
const { connectDB, disconnectDB, clearDB, signToken, buildApp } = require('./helpers');
const donationsRouter = require('../routes/donations');
const Donation = require('../models/Donation');

const app = buildApp('/api/donations', donationsRouter);

beforeAll(async () => { await connectDB(); });
afterAll(async () => { await disconnectDB(); });
beforeEach(async () => { await clearDB(); });

function donationPayload(overrides = {}) {
  return {
    name: 'Jane Donor',
    email: 'jane@donor.com',
    amount: 25,
    message: 'Happy to help!',
    isAnonymous: false,
    ...overrides,
  };
}

// ── POST /api/donations ───────────────────────────────────

describe('POST /api/donations', () => {
  it('creates a completed donation', async () => {
    const res = await request(app).post('/api/donations').send(donationPayload());
    expect(res.status).toBe(201);
    expect(res.body.donation.amount).toBe(25);
    expect(res.body.donation.status).toBe('completed');
    expect(res.body.donation.stripePaymentIntentId).toMatch(/^simulated_/);
  });

  it('rejects amount below 1', async () => {
    const res = await request(app).post('/api/donations').send(donationPayload({ amount: 0 }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minimum/i);
  });

  it('stores anonymous flag correctly', async () => {
    const res = await request(app).post('/api/donations').send(donationPayload({ isAnonymous: true }));
    expect(res.status).toBe(201);
    expect(res.body.donation.isAnonymous).toBe(true);
  });
});

// ── GET /api/donations ────────────────────────────────────

describe('GET /api/donations', () => {
  beforeEach(async () => {
    await Donation.create([
      { donor: { name: 'Alice', email: 'alice@t.com' }, amount: 10, status: 'completed', isAnonymous: false },
      { donor: { name: 'Bob',   email: 'bob@t.com'   }, amount: 20, status: 'completed', isAnonymous: true  },
      { donor: { name: 'Carol', email: 'carol@t.com' }, amount: 30, status: 'pending',   isAnonymous: false },
    ]);
  });

  it('only returns completed donations', async () => {
    const res = await request(app).get('/api/donations');
    expect(res.status).toBe(200);
    expect(res.body.donations.every(d => d.status === 'completed')).toBe(true);
    expect(res.body.donations).toHaveLength(2);
  });

  it('hides donor name and email for anonymous donations', async () => {
    const res = await request(app).get('/api/donations');
    const anon = res.body.donations.find(d => d.isAnonymous);
    expect(anon.donor.name).toBe('Anonymous');
    expect(anon.donor.email).toBe('');
  });
});

// ── GET /api/donations/stats ──────────────────────────────

describe('GET /api/donations/stats', () => {
  it('returns correct totals', async () => {
    await Donation.create([
      { donor: { name: 'A', email: 'a@t.com' }, amount: 15, status: 'completed', isAnonymous: false },
      { donor: { name: 'B', email: 'b@t.com' }, amount: 35, status: 'completed', isAnonymous: false },
      { donor: { name: 'C', email: 'c@t.com' }, amount: 100, status: 'failed',   isAnonymous: false },
    ]);

    const res = await request(app).get('/api/donations/stats');
    expect(res.status).toBe(200);
    expect(res.body.totalRaised).toBe(50);
    expect(res.body.donationCount).toBe(2);
  });

  it('returns zeros when no donations exist', async () => {
    const res = await request(app).get('/api/donations/stats');
    expect(res.status).toBe(200);
    expect(res.body.totalRaised).toBe(0);
    expect(res.body.donationCount).toBe(0);
  });
});
