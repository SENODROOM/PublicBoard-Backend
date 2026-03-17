import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Donation from '../models/Donation';
import donationsRoutes from '../routes/donations';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
    },
  }));
});

describe('Donations Routes', () => {
  let app;
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    app = express();
    app.use(express.json());
    app.use('/api/donations', donationsRoutes);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Donation.deleteMany({});
    await User.deleteMany({});
  });

  describe('GET /api/donations', () => {
    beforeEach(async () => {
      // Create test donations
      await Donation.create([
        {
          donor: { name: 'John Doe', email: 'john@example.com' },
          amount: 50,
          message: 'Great cause!',
          isAnonymous: false,
          status: 'completed',
          createdAt: new Date()
        },
        {
          donor: { name: 'Jane Smith', email: 'jane@example.com' },
          amount: 25,
          message: 'Happy to help',
          isAnonymous: true,
          status: 'completed',
          createdAt: new Date()
        },
        {
          donor: { name: 'Bob Johnson', email: 'bob@example.com' },
          amount: 100,
          status: 'pending',
          createdAt: new Date()
        }
      ]);
    });

    test('should get completed donations', async () => {
      const response = await request(app)
        .get('/api/donations')
        .expect(200);

      expect(response.body).toHaveProperty('donations');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('pages');
      expect(response.body.donations).toHaveLength(2); // Only completed donations
    });

    test('should anonymize anonymous donations', async () => {
      const response = await request(app)
        .get('/api/donations')
        .expect(200);

      const anonymousDonation = response.body.donations.find((d: any) => d.donor.name === 'Anonymous');
      expect(anonymousDonation).toBeTruthy();
    });

    test('should paginate results', async () => {
      // Create more donations
      for (let i = 0; i < 25; i++) {
        await Donation.create({
          donor: { name: `Donor ${i}`, email: `donor${i}@example.com` },
          amount: 10,
          status: 'completed',
          createdAt: new Date()
        });
      }

      const response = await request(app)
        .get('/api/donations?page=1&limit=10')
        .expect(200);

      expect(response.body.donations).toHaveLength(10);
      expect(response.body.page).toBe(1);
      expect(response.body.pages).toBeGreaterThan(1);
    });

    test('should filter by status', async () => {
      const response = await request(app)
        .get('/api/donations?status=completed')
        .expect(200);

      response.body.donations.forEach((donation: any) => {
        expect(donation.status).toBe('completed');
      });
    });
  });

  describe('GET /api/donations/stats', () => {
    beforeEach(async () => {
      await Donation.create([
        { donor: { name: 'Donor 1', email: 'donor1@example.com' }, amount: 50, status: 'completed' },
        { donor: { name: 'Donor 2', email: 'donor2@example.com' }, amount: 25, status: 'completed' },
        { donor: { name: 'Donor 3', email: 'donor3@example.com' }, amount: 100, status: 'pending' }
      ]);
    });

    test('should get donation statistics', async () => {
      const response = await request(app)
        .get('/api/donations/stats')
        .expect(200);

      expect(response.body).toHaveProperty('totalRaised', 75); // Only completed donations
      expect(response.body).toHaveProperty('donationCount', 2);
    });

    test('should return zero stats when no donations', async () => {
      const response = await request(app)
        .get('/api/donations/stats')
        .expect(200);

      expect(response.body.totalRaised).toBe(0);
      expect(response.body.donationCount).toBe(0);
    });
  });

  describe('POST /api/donations/create-payment-intent', () => {
    test('should create payment intent successfully', async () => {
      const donationData = {
        amount: 50,
        name: 'John Doe',
        email: 'john@example.com',
        message: 'Great cause!',
        isAnonymous: false
      };

      // Mock Stripe
      const { create } = require('stripe')().paymentIntents;
      create.mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret'
      });

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send(donationData)
        .expect(200);

      expect(response.body).toHaveProperty('clientSecret');
      expect(response.body).toHaveProperty('donationId');
      expect(create).toHaveBeenCalledWith({
        amount: 5000, // 50 * 100 cents
        currency: 'usd',
        metadata: {
          donationId: expect.any(String),
          donorName: 'John Doe',
          donorEmail: 'john@example.com'
        },
        receipt_email: 'john@example.com'
      });
    });

    test('should return 400 for invalid amount', async () => {
      const donationData = {
        amount: 0.5, // Less than $1
        name: 'John Doe',
        email: 'john@example.com'
      };

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send(donationData)
        .expect(400);

      expect(response.body.message).toContain('Minimum donation is $1');
    });

    test('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send({
          amount: 50
          // Missing name and email
        })
        .expect(400);

      expect(response.body.message).toContain('required');
    });

    test('should return 400 for invalid email', async () => {
      const donationData = {
        amount: 50,
        name: 'John Doe',
        email: 'invalid-email'
      };

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send(donationData)
        .expect(400);

      expect(response.body.message).toContain('Valid email is required');
    });

    test('should return 400 for message too long', async () => {
      const donationData = {
        amount: 50,
        name: 'John Doe',
        email: 'john@example.com',
        message: 'A'.repeat(501) // Over 500 characters
      };

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send(donationData)
        .expect(400);

      expect(response.body.message).toContain('under 500 characters');
    });

    test('should handle maximum amount limit', async () => {
      const donationData = {
        amount: 15000, // Over $10,000
        name: 'John Doe',
        email: 'john@example.com'
      };

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send(donationData)
        .expect(400);

      expect(response.body.message).toContain('Maximum donation is $10,000');
    });

    test('should create donation record with pending status', async () => {
      const donationData = {
        amount: 50,
        name: 'John Doe',
        email: 'john@example.com'
      };

      // Mock Stripe
      const { create } = require('stripe')().paymentIntents;
      create.mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret'
      });

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send(donationData)
        .expect(200);

      // Check that donation was created with pending status
      const donation = await Donation.findOne({ 'donor.email': 'john@example.com' });
      expect(donation).toBeTruthy();
      expect(donation.status).toBe('pending');
      expect(donation.amount).toBe(50);
      expect(donation.stripePaymentIntentId).toBe('pi_test_123');
    });

    test('should associate donation with authenticated user', async () => {
      // Create and login user
      const user = await User.create({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        });

      const donationData = {
        amount: 50,
        name: 'Test User',
        email: 'test@example.com'
      };

      // Mock Stripe
      const { create } = require('stripe')().paymentIntents;
      create.mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret'
      });

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .set('Authorization', `Bearer ${loginResponse.body.token}`)
        .send(donationData)
        .expect(200);

      // Check that donation is associated with user
      const donation = await Donation.findOne({ 'donor.userId': user._id });
      expect(donation).toBeTruthy();
      expect(donation.donor.userId).toBe(user._id.toString());
    });

    test('should handle Stripe errors gracefully', async () => {
      const donationData = {
        amount: 50,
        name: 'John Doe',
        email: 'john@example.com'
      };

      // Mock Stripe error
      const { create } = require('stripe')().paymentIntents;
      create.mockRejectedValue(new Error('Stripe API error'));

      const response = await request(app)
        .post('/api/donations/create-payment-intent')
        .send(donationData)
        .expect(500);

      expect(response.body.message).toContain('Payment initialization failed');
    });
  });

  describe('POST /api/donations (legacy)', () => {
    test('should create donation directly (legacy endpoint)', async () => {
      const donationData = {
        name: 'John Doe',
        email: 'john@example.com',
        amount: 50,
        message: 'Test donation',
        isAnonymous: false
      };

      const response = await request(app)
        .post('/api/donations')
        .send(donationData)
        .expect(201);

      expect(response.body.donation.amount).toBe(50);
      expect(response.body.donation.status).toBe('completed');
      expect(response.body.donation.donor.name).toBe('John Doe');
    });

    test('should return 400 for invalid donation data', async () => {
      const response = await request(app)
        .post('/api/donations')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          amount: 0 // Invalid amount
        })
        .expect(400);

      expect(response.body.message).toContain('Minimum donation is $1');
    });
  });
});
