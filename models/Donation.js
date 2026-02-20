const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donor: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'usd' },
  message: { type: String, maxlength: 500 },
  isAnonymous: { type: Boolean, default: false },
  stripePaymentIntentId: String,
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  relatedIssue: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', default: null }
}, { timestamps: true });

module.exports = mongoose.model('Donation', donationSchema);
