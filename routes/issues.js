const express = require("express");
const Issue = require("../models/Issue");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const { protect, optionalAuth, adminOnly } = require("../middleware/auth");
const { createLimiter } = require("../middleware/rateLimiter");
const broadcast = require("../utils/broadcast");
const createNotification = require("../utils/createNotification");
const { sendStatusEmail } = require("../utils/email");
const { validateIssue } = require("../middleware/validate");

const router = express.Router();

// ── GET /api/issues ───────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const {
      status, category, search, sort = "-createdAt",
      priority, tags, neighborhood, page = 1, limit = 20,
    } = req.query;

    // Clamp pagination to prevent abuse
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status && status !== "All") filter.status = status;
    if (category && category !== "All") filter.category = category;
    if (priority && priority !== "All") filter.priority = priority;
    if (neighborhood) filter.neighborhood = { $regex: neighborhood.slice(0, 100), $options: "i" };
    if (tags) filter.tags = { $in: tags.split(",").slice(0, 10) };

    // Try text search first, fall back to regex
    if (search && search.trim()) {
      const q = search.trim().slice(0, 200);
      try {
        filter.$text = { $search: q };
      } catch {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
          { location: { $regex: q, $options: "i" } },
        ];
      }
    }

    const [issues, total] = await Promise.all([
      Issue.find(filter).sort(sort).skip(skip).limit(limitNum).lean(),
      Issue.countDocuments(filter),
    ]);

    res.json({ issues, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/issues/stats ─────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [total, open, inProgress, resolved, pendingReview, priorityBreakdown, topTags, neighborhoods] =
      await Promise.all([
        Issue.countDocuments(),
        Issue.countDocuments({ status: "Open" }),
        Issue.countDocuments({ status: "In Progress" }),
        Issue.countDocuments({ status: "Resolved" }),
        Issue.countDocuments({ status: "Pending Review" }),
        Issue.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
        Issue.aggregate([
          { $unwind: "$tags" },
          { $group: { _id: "$tags", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        Issue.aggregate([
          { $match: { neighborhood: { $ne: "", $exists: true } } },
          { $group: { _id: "$neighborhood", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
      ]);
    res.json({ total, open, inProgress, resolved, pendingReview, priorityBreakdown, topTags, neighborhoods });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/issues/:id/related ───────────────────────────
router.get("/:id/related", async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: "Not found" });
    const related = await Issue.find({
      _id: { $ne: issue._id },
      $or: [
        { category: issue.category },
        { tags: { $in: issue.tags || [] } },
        ...(issue.neighborhood ? [{ neighborhood: issue.neighborhood }] : []),
      ],
    })
      .sort("-supportCount")
      .limit(4)
      .select("title status category supportCount priority")
      .lean();
    res.json({ related });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/issues/:id ───────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const issue = await Issue.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/issues ──────────────────────────────────────
router.post("/", optionalAuth, createLimiter, validateIssue, async (req, res) => {
  try {
    const { title, description, category, location, priority, tags, neighborhood } = req.body;

    // Build reporter — never trust client-supplied userId/email when user is logged in
    let reporterData;
    if (req.user) {
      reporterData = {
        name: req.user.name,
        email: req.user.email,
        userId: req.user._id,
      };
    } else {
      const { name, email } = req.body.reporter || {};
      if (!name?.trim() || !email?.trim())
        return res.status(400).json({ message: "Reporter name and email are required" });
      // Validate email format
      if (!/^\S+@\S+\.\S+$/.test(email))
        return res.status(400).json({ message: "Invalid reporter email" });
      reporterData = { name: name.trim(), email: email.toLowerCase().trim(), userId: null };
    }

    const issue = await Issue.create({
      title: title.trim(),
      description: description.trim(),
      category,
      location: location.trim(),
      reporter: reporterData,
      priority: priority || "Medium",
      tags: (tags || []).slice(0, 10).map((t) => t.trim().slice(0, 30)),
      neighborhood: (neighborhood || "").trim().slice(0, 100),
    });

    await ActivityLog.create({
      actor: { userId: reporterData.userId || null, name: reporterData.name, role: "user" },
      action: "issue.created",
      target: { type: "issue", id: issue._id.toString(), label: title },
      ip: req.ip,
    });

    // Update user stats & badges
    if (req.user) {
      const user = await User.findById(req.user._id);
      if (user) {
        user.stats.issuesReportedCount += 1;
        user.reputation += 10;
        const existingIds = user.badges.map((b) => b.id);
        if (user.stats.issuesReportedCount === 1 && !existingIds.includes("first_report"))
          user.badges.push(User.BADGES.FIRST_REPORT);
        if (user.stats.issuesReportedCount === 5 && !existingIds.includes("five_reports"))
          user.badges.push(User.BADGES.FIVE_REPORTS);
        if (user.stats.issuesReportedCount === 10 && !existingIds.includes("ten_reports"))
          user.badges.push(User.BADGES.TEN_REPORTS);
        await user.save();
      }
    }

    broadcast(req.app, "issue.created", {
      id: issue._id,
      title: issue.title,
      category: issue.category,
      status: issue.status,
      priority: issue.priority,
    });

    res.status(201).json({ issue });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── POST /api/issues/:id/support ──────────────────────────
router.post("/:id/support", protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    const already = issue.supporters.includes(req.user._id);
    if (already) {
      issue.supporters.pull(req.user._id);
      issue.supportCount = Math.max(0, issue.supportCount - 1);
    } else {
      issue.supporters.push(req.user._id);
      issue.supportCount += 1;
      if (issue.reporter.userId && issue.reporter.userId.toString() !== req.user._id.toString()) {
        await createNotification(req.app, {
          recipient: issue.reporter.userId,
          type: "issue.supported",
          title: "Someone supported your issue",
          message: `${req.user.name} upvoted "${issue.title}"`,
          link: `/issues/${issue._id}`,
          actor: { name: req.user.name, userId: req.user._id },
        });
      }
    }
    await issue.save();
    broadcast(req.app, "issue.support", { id: issue._id, supportCount: issue.supportCount });
    res.json({ issue, supported: !already });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/issues/:id/bookmark ─────────────────────────
router.post("/:id/bookmark", protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    const bookmarked = issue.bookmarks.includes(req.user._id);
    if (bookmarked) {
      issue.bookmarks.pull(req.user._id);
      await User.findByIdAndUpdate(req.user._id, { $pull: { bookmarks: issue._id } });
    } else {
      issue.bookmarks.push(req.user._id);
      await User.findByIdAndUpdate(req.user._id, { $addToSet: { bookmarks: issue._id } });
    }
    await issue.save();
    res.json({ issue, bookmarked: !bookmarked });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/issues/:id/watch ────────────────────────────
router.post("/:id/watch", protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    const watching = issue.watchers.includes(req.user._id);
    if (watching) issue.watchers.pull(req.user._id);
    else issue.watchers.push(req.user._id);
    await issue.save();
    res.json({ issue, watching: !watching });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/issues/:id/comments ────────────────────────
router.post("/:id/comments", protect, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ message: "Comment text required" });
    if (text.trim().length > 1000) return res.status(400).json({ message: "Comment too long (max 1000 chars)" });

    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    if (issue.isLocked && req.user.role === "user")
      return res.status(403).json({ message: "Comments are locked on this issue" });

    const mentions = (text.match(/@(\w+)/g) || []).map((m) => m.slice(1)).slice(0, 5);

    issue.comments.push({
      author: { name: req.user.name, userId: req.user._id, role: req.user.role },
      text: text.trim(),
      isAdminNote: req.user.role === "admin",
      mentions,
    });
    await issue.save();
    await User.findByIdAndUpdate(req.user._id, { $inc: { "stats.commentsCount": 1 } });

    if (issue.reporter.userId && issue.reporter.userId.toString() !== req.user._id.toString()) {
      await createNotification(req.app, {
        recipient: issue.reporter.userId,
        type: "issue.commented",
        title: "New comment on your issue",
        message: `${req.user.name}: "${text.slice(0, 80)}"`,
        link: `/issues/${issue._id}`,
        actor: { name: req.user.name, userId: req.user._id },
      });
    }

    for (const username of mentions) {
      const mentioned = await User.findOne({ name: { $regex: `^${username}$`, $options: "i" } });
      if (mentioned && mentioned._id.toString() !== req.user._id.toString()) {
        await createNotification(req.app, {
          recipient: mentioned._id,
          type: "mention",
          title: `${req.user.name} mentioned you`,
          message: `In: "${issue.title}" — ${text.slice(0, 80)}`,
          link: `/issues/${issue._id}`,
          actor: { name: req.user.name, userId: req.user._id },
        });
      }
    }

    const newComment = issue.comments[issue.comments.length - 1];
    broadcast(req.app, "issue.comment", {
      issueId: issue._id,
      comment: { _id: newComment._id, author: newComment.author, text: newComment.text, createdAt: newComment.createdAt },
    });

    res.status(201).json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/issues/:id/comments/:commentId ────────────
router.delete("/:id/comments/:commentId", protect, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Not found" });
    const comment = issue.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    const isOwner = comment.author.userId?.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== "admin") return res.status(403).json({ message: "Not authorized" });
    issue.comments.pull(req.params.commentId);
    await issue.save();
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /api/issues/:id/status ──────────────────────────
router.patch("/:id/status", protect, async (req, res) => {
  try {
    const { status, message } = req.body;
    if (!status) return res.status(400).json({ message: "Status is required" });

    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Not found" });

    const isAdmin = req.user.role === "admin" || req.user.role === "moderator";
    const isReporter = issue.reporter.userId?.toString() === req.user._id.toString();
    if (!isAdmin && !isReporter) return res.status(403).json({ message: "Not authorized" });

    const prevStatus = issue.status;
    issue.status = status;

    if (status === "Resolved" && prevStatus !== "Resolved") {
      issue.resolvedAt = new Date();
      issue.resolutionTimeHours = Math.round((issue.resolvedAt - issue.createdAt) / 3600000);
      if (issue.reporter.userId) {
        const user = await User.findById(issue.reporter.userId);
        if (user) {
          user.stats.issuesResolvedCount += 1;
          user.reputation += 25;
          const existingIds = user.badges.map((b) => b.id);
          if (user.stats.issuesResolvedCount === 1 && !existingIds.includes("first_resolve"))
            user.badges.push(User.BADGES.FIRST_RESOLVE);
          if (user.stats.issuesResolvedCount === 5 && !existingIds.includes("five_resolves"))
            user.badges.push(User.BADGES.FIVE_RESOLVES);
          await user.save();
        }
      }
    }

    if (message) issue.updates.push({ message: message.slice(0, 500), status, updatedBy: req.user.name });
    await issue.save();

    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: "issue.status_changed",
      target: { type: "issue", id: issue._id.toString(), label: issue.title },
      meta: { from: prevStatus, to: status },
      ip: req.ip,
    });

    // Notify all watchers
    for (const watcherId of issue.watchers) {
      if (watcherId.toString() !== req.user._id.toString()) {
        await createNotification(req.app, {
          recipient: watcherId,
          type: "issue.status_changed",
          title: `Issue status updated: ${status}`,
          message: `"${issue.title}" changed from ${prevStatus} → ${status}`,
          link: `/issues/${issue._id}`,
          actor: { name: req.user.name, userId: req.user._id },
        });
      }
    }

    // Email the reporter if they have a verified email
    if (issue.reporter.email && status !== prevStatus) {
      sendStatusEmail({
        to: issue.reporter.email,
        reporterName: issue.reporter.name,
        issueTitle: issue.title,
        status,
        message,
        issueUrl: `${process.env.FRONTEND_URL}/issues/${issue._id}`,
      }).catch(() => {}); // fire-and-forget
    }

    broadcast(req.app, "issue.status", { id: issue._id, status, prevStatus, title: issue.title });
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /api/issues/:id/lock ────────────────────────────
router.patch("/:id/lock", protect, adminOnly, async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Not found" });
    issue.isLocked = !issue.isLocked;
    await issue.save();
    res.json({ issue, locked: issue.isLocked });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /api/issues/:id/assign ──────────────────────────
router.patch("/:id/assign", protect, adminOnly, async (req, res) => {
  try {
    const { userId, name } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Not found" });
    issue.assignedTo = { userId: userId || null, name: (name || "").slice(0, 80) };
    await issue.save();
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/issues/:id ────────────────────────────────
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const issue = await Issue.findByIdAndDelete(req.params.id);
    if (!issue) return res.status(404).json({ message: "Not found" });
    await ActivityLog.create({
      actor: { userId: req.user._id, name: req.user.name, role: req.user.role },
      action: "issue.deleted",
      target: { type: "issue", id: req.params.id, label: issue.title },
      ip: req.ip,
    });
    broadcast(req.app, "issue.deleted", { id: req.params.id });
    res.json({ message: "Issue deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/issues/export/csv ────────────────────────────
router.get("/export/csv", protect, adminOnly, async (req, res) => {
  try {
    const issues = await Issue.find().sort("-createdAt").lean();
    const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
    const headers = ["ID","Title","Category","Priority","Status","Neighborhood","Location","Reporter","Support","Views","Comments","Resolution (hrs)","Created"];
    const rows = issues.map((i) => [
      i._id, esc(i.title), i.category, i.priority, i.status,
      esc(i.neighborhood), esc(i.location), esc(i.reporter?.name),
      i.supportCount, i.views || 0, i.comments?.length || 0,
      i.resolutionTimeHours || "",
      new Date(i.createdAt).toISOString(),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="issues.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;