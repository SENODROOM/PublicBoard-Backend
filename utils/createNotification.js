const Notification = require("../models/Notification");

/**
 * Creates an in-app notification and optionally broadcasts it via SSE.
 */
async function createNotification(
  app,
  { recipient, type, title, message, link = "", actor = {}, meta = {} },
) {
  if (!recipient) return;
  try {
    const notif = await Notification.create({
      recipient,
      type,
      title,
      message,
      link,
      actor,
      meta,
    });
    // Broadcast to SSE clients so the frontend updates instantly
    if (app) {
      const broadcast = require("./broadcast");
      broadcast(app, "notification", {
        recipientId: recipient.toString(),
        notification: notif,
      });
    }
    return notif;
  } catch (err) {
    console.error("[Notification] Failed to create:", err.message);
  }
}

module.exports = createNotification;
