/**
 * Broadcasts a real-time event to all connected SSE clients.
 * Call this after any mutation (issue created, status changed, etc.)
 *
 * @param {import('express').Application} app  - Express app (has app.locals.sseClients)
 * @param {string} type                        - Event type, e.g. 'issue.created'
 * @param {object} payload                     - Data to send
 */
function broadcast(app, type, payload) {
  if (!app || !app.locals.sseClients) return;
  const message = JSON.stringify({ type, payload, ts: Date.now() });
  const dead = [];
  for (const client of app.locals.sseClients) {
    try {
      client.res.write(`data: ${message}\n\n`);
    } catch (_) {
      dead.push(client);
    }
  }
  dead.forEach((c) => app.locals.sseClients.delete(c));
}

module.exports = broadcast;
