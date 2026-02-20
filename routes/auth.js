const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'publicboard_secret_key';

const signToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });

const userPayload = (u) => ({
  id:    u._id,
  name:  u.name,
  email: u.email,
  role:  u.role          // always include role so frontend knows if admin
});

// ── Register ─────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Block registering with the env-defined admin email
    if (email && email.toLowerCase() === (process.env.ADMIN_EMAIL || '').toLowerCase()) {
      return res.status(400).json({ message: 'This email is reserved for the system admin.' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already in use' });

    const user = await User.create({ name, email, password });
    const token = signToken(user._id);
    res.status(201).json({ token, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Login ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Invalid email or password' });

    const token = signToken(user._id);
    res.json({ token, user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Get current user ──────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: userPayload(req.user) });
});

module.exports = router;
