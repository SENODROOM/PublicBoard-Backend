const express = require("express");
const Stripe = require("stripe");
const Donation = require("../models/Donation");
const User = require("../models/User");
const { protect, optionalAuth } = require("../middleware/auth");
const createNotification = require("../utils/createNotification");

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
});

// ── GET /api/donations — public feed ─────────────────────
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [donations, total] = await Promise.all([
      Donation.find({ status: "completed" })
        .sort("-createdAt")
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Donation.countDocuments({ status: "completed" }),
    ]);
    const sanitized = donations.map((d) => ({
      ...d,
      donor: d.isAnonymous ? { name: "Anonymous", email: "" } : d.donor,
    }));
    res.json({ donations: sanitized, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/donations/stats ──────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const result = await Donation.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);
    const { total = 0, count = 0 } = result[0] || {};
    res.json({ totalRaised: total, donationCount: count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/donations/create-payment-intent ─────────────
// Step 1: frontend requests a PaymentIntent, gets back client_secret
router.post("/create-payment-intent", optionalAuth, async (req, res) => {
  try {
    const { amount, name, email, message, isAnonymous, relatedIssue } = req.body;

    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum < 1)
      return res.status(400).json({ message: "Minimum donation is $1" });
    if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
    if (!email?.trim()) return res.status(400).json({ message: "Email is required" });
    if (message && message.length > 500)
      return res.status(400).json({ message: "Message must be under 500 characters" });

    // Create a pending Donation record first so we can attach it to the webhook
    const donation = await Donation.create({
      donor: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        userId: req.user?._id || null,
      },
      amount: amountNum,
      message: message?.trim() || "",
      isAnonymous: !!isAnonymous,
      relatedIssue: relatedIssue || null,
      status: "pending",
    });

    // Create Stripe PaymentIntent in cents
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amountNum * 100),
      currency: "usd",
      metadata: {
        donationId: donation._id.toString(),
        donorName: name.trim(),
        donorEmail: email.toLowerCase().trim(),
      },
      receipt_email: email.toLowerCase().trim(),
    });

    // Save the intent ID so webhook can look up the donation
    donation.stripePaymentIntentId = paymentIntent.id;
    await donation.save();

    res.json({ clientSecret: paymentIntent.client_secret, donationId: donation._id });
  } catch (err) {
    console.error("[Stripe] create-payment-intent error:", err.message);
    res.status(500).json({ message: "Payment initialization failed. Please try again." });
  }
});

module.exports = router;