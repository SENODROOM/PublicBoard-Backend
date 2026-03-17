/**
 * Stripe Webhook Handler Tests
 *
 * Strategy:
 *   - Stripe's stripe.webhooks.constructEvent() is mocked so we can
 *     feed it any event shape without needing real signatures or HTTPS.
 *   - The raw-body middleware (express.raw) is bypassed by sending
 *     a pre-built JSON Buffer directly via supertest.
 *   - MongoDB runs in-memory via MongoMemoryServer.
 */

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// ── Env setup (must be before any module that reads process.env) ──
process.env.JWT_SECRET            = 'test_secret_at_least_32_chars_long_xxx';
process.env.JWT_REFRESH_SECRET    = 'test_refresh_secret_32_chars_long_xxx';
process.env.STRIPE_SECRET_KEY     = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
process.env.NODE_ENV              = 'test';

// ── Mock Stripe before requiring the router ───────────────────────
const mockConstructEvent = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }))
);

const webhookRouter = require('../routes/webhook');
const Donation      = require('../models/Donation');
const User          = require('../models/User');
const ActivityLog   = require('../models/ActivityLog');
const Notification  = require('../models/Notification');

// ── App factory ───────────────────────────────────────────────────
function buildApp() {
  const app = express();
  // Do NOT add express.json() — the route uses express.raw() inline
  app.locals.sseClients = new Set();
  app.use('/webhook', webhookRouter);
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────
function sendEvent(app, eventObj) {
  const body = Buffer.from(JSON.stringify(eventObj));
  return request(app)
    .post('/webhook/stripe')
    .set('stripe-signature', 'valid-sig')
    .set('Content-Type', 'application/json')
    .send(body);
}

function makeEvent(type, dataObject) {
  return { type, data: { object: dataObject } };
}

// ── DB lifecycle ──────────────────────────────────────────────────
let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildApp();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  const cols = Object.values(mongoose.connection.collections);
  await Promise.all(cols.map(c => c.deleteMany({})));
  // Default: constructEvent succeeds and passes the parsed event through
  mockConstructEvent.mockImplementation((_body, _sig, _secret) => {
    return JSON.parse(_body.toString());
  });
});

// ── Signature verification ────────────────────────────────────────
describe('POST /webhook/stripe — signature verification', () => {
  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Webhook signature mismatch');
    });

    const res = await sendEvent(app, makeEvent('payment_intent.succeeded', {}));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/webhook error/i);
  });

  it('returns 200 { received: true } on any valid event', async () => {
    const res = await sendEvent(app, makeEvent('some.unknown.event', {}));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

// ── payment_intent.succeeded ──────────────────────────────────────
describe('payment_intent.succeeded', () => {
  let donation;
  let registeredUser;

  beforeEach(async () => {
    registeredUser = await User.create({
      name: 'Jane Donor',
      email: 'jane@example.com',
      password: 'pass12345',
    });

    donation = await Donation.create({
      donor: {
        name: 'Jane Donor',
        email: 'jane@example.com',
        userId: registeredUser._id,
      },
      amount: 50,
      status: 'pending',
      stripePaymentIntentId: 'pi_test_001',
    });
  });

  it('marks the matching donation as completed', async () => {
    await sendEvent(app, makeEvent('payment_intent.succeeded', { id: 'pi_test_001' }));

    const updated = await Donation.findById(donation._id);
    expect(updated.status).toBe('completed');
  });

  it('creates an ActivityLog entry for the confirmed donation', async () => {
    await sendEvent(app, makeEvent('payment_intent.succeeded', { id: 'pi_test_001' }));

    const log = await ActivityLog.findOne({ action: 'donation.created' });
    expect(log).not.toBeNull();
    expect(log.actor.name).toBe('Jane Donor');
  });

  it('awards the donor badge to a registered user who does not have it', async () => {
    await sendEvent(app, makeEvent('payment_intent.succeeded', { id: 'pi_test_001' }));

    const updatedUser = await User.findById(registeredUser._id);
    expect(updatedUser.badges.some(b => b.id === 'donor')).toBe(true);
  });

  it('adds 20 reputation to a registered user on first donation', async () => {
    await sendEvent(app, makeEvent('payment_intent.succeeded', { id: 'pi_test_001' }));

    const updatedUser = await User.findById(registeredUser._id);
    expect(updatedUser.reputation).toBe(20);
  });

  it('does not award donor badge twice if user already has it', async () => {
    await User.findByIdAndUpdate(registeredUser._id, {
      $push: { badges: User.BADGES.DONOR },
      $inc: { reputation: 20 },
    });

    await sendEvent(app, makeEvent('payment_intent.succeeded', { id: 'pi_test_001' }));

    const updatedUser = await User.findById(registeredUser._id);
    const donorBadges = updatedUser.badges.filter(b => b.id === 'donor');
    expect(donorBadges).toHaveLength(1); // still only one
    expect(updatedUser.reputation).toBe(20); // not doubled
  });

  it('creates a donation.received notification for the registered user', async () => {
    await sendEvent(app, makeEvent('payment_intent.succeeded', { id: 'pi_test_001' }));

    const notif = await Notification.findOne({
      recipient: registeredUser._id,
      type: 'donation.received',
    });
    expect(notif).not.toBeNull();
    expect(notif.message).toMatch(/\$50/);
  });

  it('still completes donation when donor has no userId (anonymous)', async () => {
    const anonDonation = await Donation.create({
      donor: { name: 'Anonymous', email: 'anon@example.com', userId: null },
      amount: 25,
      status: 'pending',
      stripePaymentIntentId: 'pi_test_anon',
    });

    await sendEvent(app, makeEvent('payment_intent.succeeded', { id: 'pi_test_anon' }));

    const updated = await Donation.findById(anonDonation._id);
    expect(updated.status).toBe('completed');
  });

  it('returns 200 even when no donation record is found for the intent', async () => {
    // Ghost intent — not in our DB
    const res = await sendEvent(
      app,
      makeEvent('payment_intent.succeeded', { id: 'pi_ghost_999' })
    );
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('returns 200 even when an internal handler error occurs', async () => {
    // Simulate a DB error mid-handler
    jest.spyOn(Donation, 'findOne').mockRejectedValueOnce(new Error('DB timeout'));

    const res = await sendEvent(
      app,
      makeEvent('payment_intent.succeeded', { id: 'pi_test_001' })
    );
    // Stripe should receive 200 — handler errors must not cause retries
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

// ── payment_intent.payment_failed ────────────────────────────────
describe('payment_intent.payment_failed', () => {
  it('marks the matching donation as failed', async () => {
    const donation = await Donation.create({
      donor: { name: 'Bob', email: 'bob@example.com' },
      amount: 30,
      status: 'pending',
      stripePaymentIntentId: 'pi_fail_001',
    });

    await sendEvent(
      app,
      makeEvent('payment_intent.payment_failed', { id: 'pi_fail_001' })
    );

    const updated = await Donation.findById(donation._id);
    expect(updated.status).toBe('failed');
  });

  it('returns 200 when no matching donation found', async () => {
    const res = await sendEvent(
      app,
      makeEvent('payment_intent.payment_failed', { id: 'pi_ghost_fail' })
    );
    expect(res.status).toBe(200);
  });

  it('does not create any ActivityLog entry for a failed payment', async () => {
    await Donation.create({
      donor: { name: 'Bob', email: 'bob@example.com' },
      amount: 30,
      status: 'pending',
      stripePaymentIntentId: 'pi_fail_002',
    });

    await sendEvent(
      app,
      makeEvent('payment_intent.payment_failed', { id: 'pi_fail_002' })
    );

    const count = await ActivityLog.countDocuments();
    expect(count).toBe(0);
  });
});

// ── charge.refunded ───────────────────────────────────────────────
describe('charge.refunded', () => {
  it('marks the matching donation as refunded', async () => {
    const donation = await Donation.create({
      donor: { name: 'Carol', email: 'carol@example.com' },
      amount: 75,
      status: 'completed',
      stripePaymentIntentId: 'pi_refund_001',
    });

    await sendEvent(
      app,
      makeEvent('charge.refunded', { payment_intent: 'pi_refund_001' })
    );

    const updated = await Donation.findById(donation._id);
    expect(updated.status).toBe('refunded');
  });

  it('returns 200 when no matching donation found for refund', async () => {
    const res = await sendEvent(
      app,
      makeEvent('charge.refunded', { payment_intent: 'pi_ghost_refund' })
    );
    expect(res.status).toBe(200);
  });
});

// ── Unhandled event types ─────────────────────────────────────────
describe('unhandled event types', () => {
  it('returns 200 for unknown event types without throwing', async () => {
    const res = await sendEvent(
      app,
      makeEvent('customer.subscription.created', { id: 'sub_123' })
    );
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('does not create any DB records for unhandled events', async () => {
    await sendEvent(app, makeEvent('invoice.paid', { id: 'inv_123' }));

    expect(await Donation.countDocuments()).toBe(0);
    expect(await ActivityLog.countDocuments()).toBe(0);
  });
});