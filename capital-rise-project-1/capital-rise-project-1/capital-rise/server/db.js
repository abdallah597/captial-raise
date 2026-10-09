'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

fs.mkdirSync(cfg.UPLOADS_DIR, { recursive: true });
const db = new DatabaseSync(cfg.DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'i1',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const ICONS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'ck'];

// Same platforms the site already supports (names/icons/keys unchanged).
const SOCIALS = [
  ['whatsapp', 'WhatsApp', 'wa'], ['facebook', 'Facebook', 'fb'], ['instagram', 'Instagram', 'ig'],
  ['linkedin', 'LinkedIn', 'in'], ['tiktok', 'TikTok', 'tt'], ['youtube', 'YouTube', 'yt'],
  ['telegram', 'Telegram', 'tg'], ['x', 'X', 'x'], ['github', 'GitHub', 'gh'],
  ['snapchat', 'Snapchat', 'snap'], ['discord', 'Discord', 'discord'], ['threads', 'Threads', 'threads'],
  ['pinterest', 'Pinterest', 'pin'], ['email', 'Email', 'mail'],
].map(([key, name, icon]) => ({ key, name, icon }));

const SEED_SERVICES = [
  ['تخليص المعاملات الحكومية', 'تخليص ومتابعة الإجراءات الحكومية بسهولة واحترافية.', 'i1'],
  ['متابعة الطلبات والإجراءات', 'متابعة حالة المعاملة خطوة بخطوة حتى إتمام الإجراءات.', 'i2'],
  ['إنجاز وطباعة المستندات', 'خدمات تجهيز وطباعة المستندات والأوراق المطلوبة.', 'i3'],
  ['خدمات تجهيز الأوراق', 'مساعدة العملاء في تجهيز المستندات اللازمة للمعاملات.', 'i4'],
  ['معاملات الشركات', 'مساعدة الشركات في إنجاز ومتابعة الإجراءات والمعاملات.', 'i5'],
  ['معاملات الأفراد', 'توفير المساعدة اللازمة لإنجاز معاملات الأفراد بسهولة.', 'i6'],
];

const now = () => Date.now();

function getSetting(key, fallback = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}

function seed() {
  // Services: only when the table has never been populated (so deleting all later stays deleted).
  if (!getSetting('seeded_services')) {
    const ins = db.prepare('INSERT INTO services(title,description,icon,visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    SEED_SERVICES.forEach(([t, d, i], n) => ins.run(t, d, i, 1, n + 1, now(), now()));
    setSetting('seeded_services', '1');
  }
  if (!getSetting('seeded_certificates')) {
    // Mirrors the demo certificate the current site already shows (no image yet).
    db.prepare('INSERT INTO certificates(title,description,image,visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run('شهادة تقدير تجريبية', 'نموذج توضيحي لشكل شهادة التقدير داخل الموقع.', '', 1, 1, now(), now());
    setSetting('seeded_certificates', '1');
  }
  if (!getSetting('whatsapp_number')) setSetting('whatsapp_number', cfg.DEFAULT_WHATSAPP);
  if (!getSetting('wa_message')) setSetting('wa_message', 'مرحباً، أريد بدء معاملة مع CAPITAL RISE');
  for (const k of ['phone', 'email', 'address', 'hours']) if (!getSetting(k, null)) setSetting(k, '');
  if (!getSetting('socials')) setSetting('socials', '{}');
}
seed();

/* ---------- public payload (what the website reads) ---------- */
function readSocials() {
  try { return JSON.parse(getSetting('socials', '{}')) || {}; } catch (_) { return {}; }
}
function publicData() {
  const number = getSetting('whatsapp_number');
  const email = getSetting('email');
  const saved = readSocials();
  const services = db.prepare('SELECT * FROM services WHERE visible=1 ORDER BY sort_order, id').all()
    .map((s) => ({ title: s.title, desc: s.description, icon: s.icon, cta: 'ابدأ الطلب', img: '', on: true }));
  const certificates = db.prepare('SELECT * FROM certificates WHERE visible=1 ORDER BY sort_order, id').all()
    .map((c) => ({ title: c.title, desc: c.description, img: c.image, on: true }));
  const socials = SOCIALS.map((p) => {
    const s = saved[p.key] || {};
    let url = s.url || '';
    if (p.key === 'whatsapp') url = number ? 'https://wa.me/' + number : '';
    if (p.key === 'email') url = email ? 'mailto:' + email : '';
    return { name: p.name, key: p.key, icon: p.icon, url, on: s.on !== false };
  });
  return {
    services,
    certificates,
    contact: {
      phone: getSetting('phone'), whatsapp: number, email,
      address: getSetting('address'), hours: getSetting('hours'), waMsg: getSetting('wa_message'),
    },
    socials,
  };
}

module.exports = { db, cfg, ICONS, SOCIALS, now, getSetting, setSetting, readSocials, publicData };
