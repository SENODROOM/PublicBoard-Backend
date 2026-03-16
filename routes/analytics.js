const express = require('express');
const Issue = require('../models/Issue');
const User = require('../models/User');
const Donation = require('../models/Donation');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(protect, adminOnly);

// ── Full analytics endpoint ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { range = '30' } = req.query;
    const days = parseInt(range);
    const since = new Date(Date.now() - days * 86400000);

    const [
      // Issues over time (daily)
      issuesTrend,
      // Resolution time by category
      resolutionByCategory,
      // Top locations
      topLocations,
      // Top neighborhoods
      topNeighborhoods,
      // Issues by day of week
      byDayOfWeek,
      // Hourly distribution (when issues are reported)
      byHour,
      // Support leaders (most supported issues)
      topIssues,
      // Monthly donations
      donationTrend,
      // User registration trend
      userTrend,
      // Avg resolution time (hours)
      avgResolutionTime,
      // Comment activity
      commentActivity,
      // Category trend over time
      categoryTrend
    ] = await Promise.all([
      // Daily issue creation
      Issue.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          created: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } }
        }},
        { $sort: { _id: 1 } }
      ]),

      // Avg resolution time by category
      Issue.aggregate([
        { $match: { status: 'Resolved', resolutionTimeHours: { $ne: null } } },
        { $group: {
          _id: '$category',
          avgHours: { $avg: '$resolutionTimeHours' },
          count: { $sum: 1 }
        }},
        { $sort: { avgHours: 1 } }
      ]),

      // Top 10 locations
      Issue.aggregate([
        { $group: { _id: '$location', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      // Top neighborhoods
      Issue.aggregate([
        { $match: { neighborhood: { $ne: '', $exists: true } } },
        { $group: { _id: '$neighborhood', count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      // Issues by day of week
      Issue.aggregate([
        { $group: {
          _id: { $dayOfWeek: '$createdAt' },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]),

      // Issues by hour of day
      Issue.aggregate([
        { $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]),

      // Top 5 most supported issues
      Issue.find({ status: { $ne: 'Resolved' } })
        .sort('-supportCount')
        .limit(5)
        .select('title supportCount category status priority')
        .lean(),

      // Monthly donation totals (last 6 months)
      Donation.aggregate([
        { $match: { status: 'completed' } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }},
        { $sort: { _id: -1 } },
        { $limit: 6 }
      ]),

      // User registrations per week
      User.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]),

      // Average resolution time overall
      Issue.aggregate([
        { $match: { resolutionTimeHours: { $ne: null, $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$resolutionTimeHours' }, min: { $min: '$resolutionTimeHours' }, max: { $max: '$resolutionTimeHours' } } }
      ]),

      // Comment count per day
      Issue.aggregate([
        { $unwind: '$comments' },
        { $match: { 'comments.createdAt': { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$comments.createdAt' } },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]),

      // Category breakdown over last N days
      Issue.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);

    const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowFormatted = Array.from({ length: 7 }, (_, i) => ({
      day: DOW_LABELS[i],
      count: (byDayOfWeek.find(d => d._id === i + 1) || {}).count || 0
    }));

    const hourFormatted = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: (byHour.find(h => h._id === i) || {}).count || 0
    }));

    res.json({
      range: days,
      issuesTrend,
      resolutionByCategory,
      topLocations,
      topNeighborhoods,
      byDayOfWeek: dowFormatted,
      byHour: hourFormatted,
      topIssues,
      donationTrend: donationTrend.reverse(),
      userTrend,
      avgResolutionTime: avgResolutionTime[0] || { avg: 0, min: 0, max: 0 },
      commentActivity,
      categoryTrend
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
