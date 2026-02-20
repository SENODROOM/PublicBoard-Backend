const User = require('../models/User');

/**
 * Auto-creates or syncs the admin user from environment variables.
 * Runs once on server startup after MongoDB connects.
 *
 * Rules:
 *  - If no user with ADMIN_EMAIL exists → create one with role:'admin'
 *  - If a user exists but is not admin → promote to admin
 *  - If ADMIN_PASSWORD changed in .env → update the password in DB
 */
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Admin';

  if (!email || !password) {
    console.warn('[Admin] ADMIN_EMAIL or ADMIN_PASSWORD not set in .env — skipping admin seed.');
    return;
  }

  try {
    let admin = await User.findOne({ email: email.toLowerCase() });

    if (!admin) {
      await User.create({ name, email, password, role: 'admin' });
      console.log(`[Admin] ✅ Admin user created: ${email}`);
    } else {
      let changed = false;

      if (admin.role !== 'admin') {
        admin.role = 'admin';
        changed = true;
        console.log(`[Admin] 🔧 Promoted existing user to admin: ${email}`);
      }

      // Re-sync password if it changed in .env
      const match = await admin.comparePassword(password);
      if (!match) {
        admin.password = password; // pre-save hook re-hashes
        changed = true;
        console.log(`[Admin] 🔑 Admin password synced from .env`);
      }

      if (changed) await admin.save();
      else console.log(`[Admin] ✅ Admin already configured: ${email}`);
    }
  } catch (err) {
    console.error('[Admin] ❌ Seed error:', err.message);
  }
}

module.exports = seedAdmin;
