const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "issue.status_changed",
        "issue.commented",
        "issue.supported",
        "mention",
        "system",
        "donation.received",
        "badge.earned",
      ],
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: "" }, // e.g. /issues/abc123
    isRead: { type: Boolean, default: false },
    actor: {
      name: String,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
