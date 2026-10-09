'use strict';
// Minimal .env loader (no dependencies). Real environment variables always win.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
try {
  const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch (_) { /* no .env file: fine */ }

const env = process.env;
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || './data');

module.exports = {
  ROOT,
  PORT: parseInt(env.PORT, 10) || 3000,
  HOST: env.HOST || '0.0.0.0',
  DATA_DIR,
  UPLOADS_DIR: path.join(DATA_DIR, 'uploads'),
  DB_FILE: path.join(DATA_DIR, 'capital-rise.db'),
  SITE_DIR: path.join(ROOT, 'site'),
  ADMIN_DIR: path.join(ROOT, 'admin'),
  ADMIN_USERNAME: env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  // Set to 1 when running behind nginx / Cloudflare / a hosting proxy that terminates HTTPS.
  TRUST_PROXY: env.TRUST_PROXY === '1',
  // Optional: serve the admin panel ONLY on this host, e.g. admin.example.com
  ADMIN_HOST: (env.ADMIN_HOST || '').toLowerCase(),
  // Force "Secure" cookies (default: automatic, based on HTTPS detection).
  COOKIE_SECURE: env.COOKIE_SECURE || 'auto',
  SESSION_HOURS: parseInt(env.SESSION_HOURS, 10) || 12,
  DEFAULT_WHATSAPP: '971541494114',
  MAX_UPLOAD_BYTES: 6 * 1024 * 1024,
};
