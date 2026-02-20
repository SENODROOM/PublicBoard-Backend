const express = require('express');
const Donation = require('../models/Donation');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Get all donations (public - anonymous ones hide name)
router.get('/', async (req, res) => {
  try {
    const donations = await Donation.find({ status: 'completed' })
      .sort('-createdAt')
      .lean();
    const sanitized = donations.map(d => ({
      ...d,
      donor: d.isAnonymous ? { name: 'Anonymous', email: '' } : d.donor
    }));
    res.json({ donations: sanitized });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get donation stats
router.get('/stats', async (req, res) => {
  try {
    const result = await Donation.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    const { total = 0, count = 0 } = result[0] || {};
    res.json({ totalRaised: total, donationCount: count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create donation (simulated - no real Stripe in demo)
router.post('/', async (req, res) => {
  try {
    const { name, email, amount, message, isAnonymous, relatedIssue } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ message: 'Minimum donation is $1' });

    const donation = await Donation.create({
      donor: { name, email },
      amount: parseFloat(amount),
      message,
      isAnonymous: isAnonymous || false,
      relatedIssue: relatedIssue || null,
      status: 'completed', // simulated success
      stripePaymentIntentId: 'simulated_' + Date.now()
    });

    res.status(201).json({ donation, message: 'Donation successful! Thank you for your contribution.' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
