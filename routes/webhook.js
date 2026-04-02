const express = require("express");
const Stripe = require("stripe");
const Donation = require("../models/Donation");
const User = require("../models/User");
const createNotification = require("../utils/createNotification");
const ActivityLog = require("../models/ActivityLog");

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
});

// IMPORTANT: This route needs the raw body — express.json() must NOT run before this.
// In index.js, register this BEFORE app.use(express.json()).
// Use express.raw({ type: 'application/json' }) as inline middleware here.

router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("[Webhook] Signature verification failed:", err.message);
      return res.status(400).json({ message: `Webhook error: ${err.message}` });
    }

    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          const intent = event.data.object;
          const donation = await Donation.findOne({
            stripePaymentIntentId: intent.id,
          });
          if (!donation) {
            console.error("[Webhook] Donation not found for intent:", intent.id);
            break;
          }

          donation.status = "completed";
          await donation.save();

          await ActivityLog.create({
            actor: {
              userId: donation.donor.userId || null,
              name: donation.donor.name,
              role: "user",
            },
            action: "donation.created",
            target: {
              type: "donation",
              id: donation._id.toString(),
              label: `$${donation.amount} from ${donation.donor.name}`,
            },
          });

          // Award donor badge if user is registered
          if (donation.donor.userId) {
            const user = await User.findById(donation.donor.userId);
            if (user) {
              const hasBadge = user.badges.some((b) => b.id === "donor");
              if (!hasBadge) {
                user.badges.push(User.BADGES.DONOR);
                user.reputation += 20;
                await user.save();
              }
              // Notify the user
              await createNotification(null, {
                recipient: user._id,
                type: "donation.received",
                title: "Donation confirmed",
                message: `Your donation of $${donation.amount} has been processed. Thank you!`,
                link: "/donate",
                actor: { name: "PublicBoard", userId: null },
              });
            }
          }

          console.log(`[Webhook] Donation ${donation._id} confirmed: $${donation.amount}`);
          break;
        }

        case "payment_intent.payment_failed": {
          const intent = event.data.object;
          await Donation.findOneAndUpdate(
            { stripePaymentIntentId: intent.id },
            { status: "failed" }
          );
          console.log(`[Webhook] Payment failed for intent: ${intent.id}`);
          break;
        }

        case "charge.refunded": {
          const charge = event.data.object;
          await Donation.findOneAndUpdate(
            { stripePaymentIntentId: charge.payment_intent },
            { status: "refunded" }
          );
          console.log(`[Webhook] Refund processed for intent: ${charge.payment_intent}`);
          break;
        }

        default:
          console.log(`[Webhook] Unhandled event type: ${event.type}`);
      }
    } catch (err) {
      console.error("[Webhook] Handler error:", err.message);
      // Return 200 anyway — Stripe retries on non-2xx
    }

    res.json({ received: true });
  }
);

module.exports = router;