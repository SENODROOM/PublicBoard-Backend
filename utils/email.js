const { Resend } = require("resend");

let resend;

function getResend() {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

/**
 * Sends a transactional email.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to      - Recipient address(es)
 * @param {string}          opts.subject - Email subject
 * @param {string}          [opts.html]  - HTML body
 * @param {string}          [opts.text]  - Plain-text fallback
 * @param {string}          [opts.from]  - Override sender (defaults to EMAIL_FROM env var)
 */
async function sendEmail({ to, subject, html, text, from }) {
  if (process.env.NODE_ENV === "test") return; // no emails in tests

  const sender = from || process.env.EMAIL_FROM || "noreply@publicboard.app";

  try {
    const r = getResend();
    const result = await r.emails.send({
      from: sender,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || `<p>${text || ""}</p>`,
      text: text || stripHtml(html || ""),
    });
    console.log(`[Email] Sent "${subject}" to ${to}`, result.id ? `(id: ${result.id})` : "");
    return result;
  } catch (err) {
    // Log but don't crash the request — email failure is non-fatal
    console.error(`[Email] Failed to send "${subject}" to ${to}:`, err.message);
  }
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Sends a status-change notification email to the issue reporter.
 */
async function sendStatusEmail({ to, reporterName, issueTitle, status, message, issueUrl }) {
  const statusColors = {
    "In Progress": "#1a4a8a",
    "Resolved": "#2a7a4a",
    "Pending Review": "#6a3a9a",
    "Open": "#c83232",
  };
  const color = statusColors[status] || "#333";

  await sendEmail({
    to,
    subject: `Your issue has been updated: ${status}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#f9f9f9">
        <div style="background:white;border-radius:8px;padding:32px;border:1px solid #e5e5e5">
          <h2 style="margin:0 0 8px;font-size:20px;">Issue Status Updated</h2>
          <p style="color:#666;margin:0 0 24px;">Hi ${reporterName},</p>

          <div style="background:#f8f9fa;border-left:4px solid ${color};padding:16px;margin-bottom:24px;border-radius:0 8px 8px 0">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#666;margin-bottom:4px">Issue</div>
            <div style="font-weight:600;font-size:16px">${issueTitle}</div>
          </div>

          <div style="display:inline-block;background:${color};color:white;padding:6px 16px;border-radius:20px;font-weight:600;margin-bottom:24px">
            ${status}
          </div>

          ${message ? `<p style="color:#555;line-height:1.6"><strong>Admin note:</strong> ${message}</p>` : ""}

          <a href="${issueUrl}" style="display:inline-block;background:#1a1a2e;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;margin-top:8px">View Issue →</a>

          <hr style="margin:32px 0;border:none;border-top:1px solid #e5e5e5" />
          <p style="color:#999;font-size:12px;margin:0">
            You're receiving this because you reported an issue on PublicBoard.
            <a href="${process.env.FRONTEND_URL}/profile" style="color:#666">Manage notifications</a>
          </p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendStatusEmail };