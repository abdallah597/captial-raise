'use strict';
const crypto = require('crypto');
const { db, cfg, now } = require('./db');

/* ---------- password hashing (scrypt, built into Node) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const got = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(got, expected);
  } catch (_) { return false; }
}
// Used to keep response time similar when the username does not exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

/* ---------- first-run admin ---------- */
function ensureAdmin() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (n > 0) return null;
  let pw = cfg.ADMIN_PASSWORD;
  let generated = false;
  if (!pw) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
  if (pw.length < 10) { throw new Error('ADMIN_PASSWORD must be at least 10 characters'); }
  db.prepare('INSERT INTO admins(username,pass_hash,created_at) VALUES(?,?,?)').run(cfg.ADMIN_USERNAME, hashPassword(pw), now());
  return { username: cfg.ADMIN_USERNAME, password: generated ? pw : null };
}

/* ---------- sessions ---------- */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const t = now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('INSERT INTO sessions(token_hash,admin_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)')
    .run(sha(token), adminId, csrf, t, t + cfg.SESSION_HOURS * 3600 * 1000);
  return { token, csrf };
}
function getSession(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT s.csrf, s.expires_at, a.id AS admin_id, a.username
    FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`).get(sha(token));
  if (!row) return null;
  if (row.expires_at < now()) { destroySession(token); return null; }
  return row;
}
function destroySession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); }
function destroyOtherSessions(adminId, keepToken) {
  db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?').run(adminId, sha(keepToken || ''));
}

/* ---------- login throttling (in memory) ---------- */
const attempts = new Map(); // key -> {n, first}
const WINDOW = 15 * 60 * 1000, MAX = 8;
function throttled(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.n >= MAX;
}
function fail(key) {
  const a = attempts.get(key);
  if (!a || now() - a.first > WINDOW) attempts.set(key, { n: 1, first: now() });
  else a.n++;
}
function clearFails(key) { attempts.delete(key); }
setInterval(() => { for (const [k, a] of attempts) if (now() - a.first > WINDOW) attempts.delete(k); }, 10 * 60 * 1000).unref();

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, ensureAdmin,
  createSession, getSession, destroySession, destroyOtherSessions,
  throttled, fail, clearFails,
};
