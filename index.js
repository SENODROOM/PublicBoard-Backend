require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const issueRoutes    = require('./routes/issues');
const authRoutes     = require('./routes/auth');
const donationRoutes = require('./routes/donations');
const adminRoutes    = require('./routes/admin');
const seedAdmin      = require('./utils/seedAdmin');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/issues',    issueRoutes);
app.use('/api/auth',      authRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/admin',     adminRoutes);

// Health check
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', message: 'PublicBoard API running' })
);

// Connect to MongoDB, then seed admin, then start server
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/publicboard';
const PORT        = process.env.PORT || 5000;

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    await seedAdmin();          // auto-create / sync admin from .env
    app.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
