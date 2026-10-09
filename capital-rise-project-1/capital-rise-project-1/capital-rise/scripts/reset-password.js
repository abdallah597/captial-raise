'use strict';
// Usage: node scripts/reset-password.js "NewStrongPassword"   (min 10 chars)
// Resets the admin password (creates the admin if missing) and logs out every session.
const { db, cfg, now } = require('../server/db');
const { hashPassword } = require('../server/auth');
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Usage: node scripts/reset-password.js "NewPassword"  (at least 10 characters)'); process.exit(1); }
const row = db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get();
if (row) { db.prepare('UPDATE admins SET pass_hash=? WHERE id=?').run(hashPassword(pw), row.id); db.exec('DELETE FROM sessions'); }
else db.prepare('INSERT INTO admins(username,pass_hash,created_at) VALUES(?,?,?)').run(cfg.ADMIN_USERNAME, hashPassword(pw), now());
console.log('Password updated. All admin sessions were closed.');
