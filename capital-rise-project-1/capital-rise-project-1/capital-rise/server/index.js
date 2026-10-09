'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, cfg, ICONS, SOCIALS, now, getSetting, setSetting, readSocials, publicData } = require('./db');
const auth = require('./auth');

/* =====================================================================
   Helpers
   ===================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};
const COOKIE = 'cr_admin';

const hostOf = (req) => String((cfg.TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || '').toLowerCase().split(',')[0].trim();
const isHttps = (req) => req.socket.encrypted || (cfg.TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
const clientIp = (req) => (cfg.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

function baseHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    ...extra,
  };
}
const CSP_SITE = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const CSP_ADMIN = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function send(res, status, body, headers = {}) {
  res.writeHead(status, baseHeaders(headers));
  res.end(body);
}
function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}
const redirect = (res, to) => send(res, 302, '', { Location: to, 'Cache-Control': 'no-store' });
const notFound = (res) => send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookieHeader(req, value, maxAgeSec) {
  const secure = cfg.COOKIE_SECURE === 'true' || (cfg.COOKIE_SECURE === 'auto' && isHttps(req));
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}
function sessionOf(req) {
  const token = parseCookies(req)[COOKIE];
  const s = auth.getSession(token);
  return s ? { ...s, token } : null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 100 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (_) { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

const cache = new Map();
function readStatic(file) {
  // Admin/site files are tiny; cache in production, re-read on every request in development.
  if (process.env.NODE_ENV === 'production' && cache.has(file)) return cache.get(file);
  const buf = fs.readFileSync(file);
  if (process.env.NODE_ENV === 'production') cache.set(file, buf);
  return buf;
}

/* =====================================================================
   Public website
   ===================================================================== */
function renderSite() {
  const tpl = readStatic(path.join(cfg.SITE_DIR, 'index.template.html')).toString('utf8');
  const data = JSON.stringify(publicData())
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return tpl.replace('<!--CR_DATA-->', `<script>window.__CR__=${data};</script>`);
}

function serveUpload(req, res, pathname) {
  const name = path.basename(decodeURIComponent(pathname.slice('/uploads/'.length)));
  if (!/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(name)) return notFound(res);
  const file = path.join(cfg.UPLOADS_DIR, name);
  fs.readFile(file, (err, buf) => {
    if (err) return notFound(res);
    send(res, 200, buf, {
      'Content-Type': MIME[path.extname(name)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'",
    });
  });
}

/* =====================================================================
   Validation
   ===================================================================== */
const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });
const str = (v, max, label, { required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw bad(`${label} مطلوب`);
  if (s.length > max) throw bad(`${label} طويل جدًا (الحد الأقصى ${max} حرف)`);
  return s;
};
const normNumber = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d && (d.length < 8 || d.length > 15)) throw bad('رقم واتساب غير صحيح. اكتبه مع كود الدولة مثل 971541494114');
  return d;
};
const safeUrl = (v, label) => {
  const s = str(v, 300, label);
  if (!s) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(s)) throw bad(`رابط ${label} يجب أن يبدأ بـ https://`);
  return s;
};
const imageUrlOk = (u) => u === '' || /^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(u);

function detectImage(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}
function deleteUploadFile(url) {
  if (!url || !imageUrlOk(url)) return;
  fs.unlink(path.join(cfg.UPLOADS_DIR, path.basename(url)), () => {});
}

/* =====================================================================
   Admin API
   ===================================================================== */
const svcOut = (r) => ({ id: r.id, title: r.title, description: r.description, icon: r.icon, visible: !!r.visible, order: r.sort_order });
const certOut = (r) => ({ id: r.id, title: r.title, description: r.description, image: r.image, visible: !!r.visible, order: r.sort_order });

function listTable(table) { return db.prepare(`SELECT * FROM ${table} ORDER BY sort_order, id`).all(); }
function nextOrder(table) { return (db.prepare(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM ${table}`).get().n); }
function moveRow(table, id, dir) {
  const rows = listTable(table);
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  const upd = db.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`);
  db.exec('BEGIN');
  try { rows.forEach((r, n) => upd.run(n + 1, r.id)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function settingsOut() {
  const saved = readSocials();
  return {
    whatsapp_number: getSetting('whatsapp_number'),
    wa_message: getSetting('wa_message'),
    phone: getSetting('phone'), email: getSetting('email'),
    address: getSetting('address'), hours: getSetting('hours'),
    socials: SOCIALS.filter((p) => p.key !== 'whatsapp' && p.key !== 'email')
      .map((p) => ({ key: p.key, name: p.name, url: (saved[p.key] || {}).url || '', on: (saved[p.key] || {}).on !== false })),
  };
}

async function adminApi(req, res, pathname, session) {
  const m = req.method;
  const idMatch = pathname.match(/^\/api\/admin\/(services|certificates)\/(\d+)(\/move)?$/);
  const body = (m === 'POST' || m === 'PUT') && pathname !== '/api/admin/upload' ? await readJson(req) : null;

  if (pathname === '/api/admin/me' && m === 'GET') return json(res, 200, { username: session.username, csrf: session.csrf });

  if (pathname === '/api/admin/logout' && m === 'POST') {
    auth.destroySession(session.token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
  }

  if (pathname === '/api/admin/password' && m === 'POST') {
    const cur = String(body.current || ''), next = String(body.next || '');
    const row = db.prepare('SELECT pass_hash FROM admins WHERE id=?').get(session.admin_id);
    if (!auth.verifyPassword(cur, row.pass_hash)) throw bad('كلمة المرور الحالية غير صحيحة');
    if (next.length < 10) throw bad('كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف');
    if (next === cur) throw bad('اختر كلمة مرور مختلفة عن الحالية');
    db.prepare('UPDATE admins SET pass_hash=? WHERE id=?').run(auth.hashPassword(next), session.admin_id);
    auth.destroyOtherSessions(session.admin_id, session.token);
    return json(res, 200, { ok: true });
  }

  /* ----- services ----- */
  if (pathname === '/api/admin/services' && m === 'GET') return json(res, 200, listTable('services').map(svcOut));
  if (pathname === '/api/admin/services' && m === 'POST') {
    const title = str(body.title, 120, 'اسم الخدمة', { required: true });
    const description = str(body.description, 1000, 'الوصف');
    const icon = ICONS.includes(body.icon) ? body.icon : 'i1';
    const visible = body.visible === false ? 0 : 1;
    const r = db.prepare('INSERT INTO services(title,description,icon,visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(title, description, icon, visible, nextOrder('services'), now(), now());
    return json(res, 201, svcOut(db.prepare('SELECT * FROM services WHERE id=?').get(Number(r.lastInsertRowid))));
  }
  if (idMatch && idMatch[1] === 'services') {
    const id = Number(idMatch[2]);
    const row = db.prepare('SELECT * FROM services WHERE id=?').get(id);
    if (!row) return json(res, 404, { error: 'الخدمة غير موجودة' });
    if (idMatch[3] && m === 'POST') { moveRow('services', id, body.dir === 'up' ? 'up' : 'down'); return json(res, 200, listTable('services').map(svcOut)); }
    if (m === 'PUT') {
      const title = body.title !== undefined ? str(body.title, 120, 'اسم الخدمة', { required: true }) : row.title;
      const description = body.description !== undefined ? str(body.description, 1000, 'الوصف') : row.description;
      const icon = body.icon !== undefined ? (ICONS.includes(body.icon) ? body.icon : row.icon) : row.icon;
      const visible = body.visible !== undefined ? (body.visible ? 1 : 0) : row.visible;
      db.prepare('UPDATE services SET title=?,description=?,icon=?,visible=?,updated_at=? WHERE id=?').run(title, description, icon, visible, now(), id);
      return json(res, 200, svcOut(db.prepare('SELECT * FROM services WHERE id=?').get(id)));
    }
    if (m === 'DELETE') { db.prepare('DELETE FROM services WHERE id=?').run(id); return json(res, 200, { ok: true }); }
  }

  /* ----- certificates ----- */
  if (pathname === '/api/admin/certificates' && m === 'GET') return json(res, 200, listTable('certificates').map(certOut));
  if (pathname === '/api/admin/certificates' && m === 'POST') {
    const image = String(body.image || '');
    if (!imageUrlOk(image)) throw bad('الصورة غير صالحة');
    if (!image) throw bad('اختر صورة الشهادة أولًا');
    const title = str(body.title, 120, 'العنوان');
    const description = str(body.description, 600, 'الوصف');
    const visible = body.visible === false ? 0 : 1;
    const r = db.prepare('INSERT INTO certificates(title,description,image,visible,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(title, description, image, visible, nextOrder('certificates'), now(), now());
    return json(res, 201, certOut(db.prepare('SELECT * FROM certificates WHERE id=?').get(Number(r.lastInsertRowid))));
  }
  if (idMatch && idMatch[1] === 'certificates') {
    const id = Number(idMatch[2]);
    const row = db.prepare('SELECT * FROM certificates WHERE id=?').get(id);
    if (!row) return json(res, 404, { error: 'الشهادة غير موجودة' });
    if (idMatch[3] && m === 'POST') { moveRow('certificates', id, body.dir === 'up' ? 'up' : 'down'); return json(res, 200, listTable('certificates').map(certOut)); }
    if (m === 'PUT') {
      const title = body.title !== undefined ? str(body.title, 120, 'العنوان') : row.title;
      const description = body.description !== undefined ? str(body.description, 600, 'الوصف') : row.description;
      const visible = body.visible !== undefined ? (body.visible ? 1 : 0) : row.visible;
      let image = row.image;
      if (body.image !== undefined && body.image !== row.image) {
        if (!imageUrlOk(String(body.image)) || !body.image) throw bad('الصورة غير صالحة');
        image = body.image;
      }
      db.prepare('UPDATE certificates SET title=?,description=?,image=?,visible=?,updated_at=? WHERE id=?').run(title, description, image, visible, now(), id);
      if (image !== row.image) deleteUploadFile(row.image);
      return json(res, 200, certOut(db.prepare('SELECT * FROM certificates WHERE id=?').get(id)));
    }
    if (m === 'DELETE') { db.prepare('DELETE FROM certificates WHERE id=?').run(id); deleteUploadFile(row.image); return json(res, 200, { ok: true }); }
  }

  /* ----- image upload (raw bytes, validated by file signature) ----- */
  if (pathname === '/api/admin/upload' && m === 'POST') {
    const buf = await readBody(req, cfg.MAX_UPLOAD_BYTES);
    const ext = detectImage(buf);
    if (!ext) throw bad('الملف ليس صورة مدعومة. استخدم PNG أو JPG أو WEBP');
    const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(cfg.UPLOADS_DIR, name), buf);
    return json(res, 201, { url: '/uploads/' + name });
  }

  /* ----- contact / WhatsApp settings ----- */
  if (pathname === '/api/admin/settings' && m === 'GET') return json(res, 200, settingsOut());
  if (pathname === '/api/admin/settings' && m === 'PUT') {
    const number = normNumber(body.whatsapp_number);
    if (!number) throw bad('رقم واتساب مطلوب');
    const email = str(body.email, 150, 'البريد الإلكتروني');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('البريد الإلكتروني غير صحيح');
    const next = {
      whatsapp_number: number,
      wa_message: str(body.wa_message, 300, 'رسالة واتساب'),
      phone: str(body.phone, 40, 'رقم الهاتف'), email,
      address: str(body.address, 200, 'العنوان'), hours: str(body.hours, 120, 'ساعات العمل'),
    };
    const socials = {};
    for (const p of SOCIALS) {
      if (p.key === 'whatsapp' || p.key === 'email') continue;
      const item = Array.isArray(body.socials) ? body.socials.find((x) => x && x.key === p.key) : null;
      if (item) socials[p.key] = { url: safeUrl(item.url, p.name), on: item.on !== false };
    }
    db.exec('BEGIN');
    try {
      for (const [k, v] of Object.entries(next)) setSetting(k, v);
      setSetting('socials', JSON.stringify(socials));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return json(res, 200, settingsOut());
  }

  return json(res, 404, { error: 'غير موجود' });
}

/* =====================================================================
   Login
   ===================================================================== */
async function handleLogin(req, res) {
  const body = await readJson(req);
  const username = String(body.username || '').trim().slice(0, 60);
  const password = String(body.password || '').slice(0, 200);
  const ipKey = 'ip:' + clientIp(req), userKey = 'u:' + username.toLowerCase();
  if (auth.throttled(ipKey) || auth.throttled(userKey)) {
    return json(res, 429, { error: 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة.' });
  }
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  const ok = auth.verifyPassword(password, row ? row.pass_hash : auth.DUMMY_HASH) && !!row;
  if (!ok) {
    auth.fail(ipKey); auth.fail(userKey);
    await new Promise((r) => setTimeout(r, 500));
    return json(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  auth.clearFails(ipKey); auth.clearFails(userKey);
  const s = auth.createSession(row.id);
  return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, s.token, cfg.SESSION_HOURS * 3600) });
}

/* =====================================================================
   Router
   ===================================================================== */
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin form/fetch from some browsers omit it; CSRF token still required
  try { return new URL(origin).host.toLowerCase() === hostOf(req); } catch (_) { return false; }
}

const PUBLIC_ADMIN_ASSETS = new Set(['login.js', 'admin.css']);
const PRIVATE_ADMIN_ASSETS = new Set(['app.js']);

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  const host = hostOf(req);
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/');

  // Optional split: admin lives only on ADMIN_HOST (e.g. admin.example.com).
  if (cfg.ADMIN_HOST) {
    const onAdminHost = host === cfg.ADMIN_HOST;
    if (isAdminPath && !onAdminHost) return notFound(res);
    if (onAdminHost && !isAdminPath && !pathname.startsWith('/uploads/') && pathname !== '/healthz') return redirect(res, '/admin');
  }

  if (pathname === '/healthz') return json(res, 200, { ok: true });
  if (pathname.startsWith('/uploads/') && req.method === 'GET') return serveUpload(req, res, pathname);

  /* ---------- admin ---------- */
  if (isAdminPath) {
    const adminHeaders = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': CSP_ADMIN };

    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (!originOk(req)) return json(res, 403, { error: 'طلب مرفوض' });
      return handleLogin(req, res);
    }
    if (pathname === '/admin/login' && req.method === 'GET') {
      if (sessionOf(req)) return redirect(res, '/admin');
      return send(res, 200, readStatic(path.join(cfg.ADMIN_DIR, 'login.html')), { ...adminHeaders, 'Content-Type': MIME['.html'] });
    }
    const asset = pathname.match(/^\/admin\/assets\/([\w.-]+)$/);
    if (asset && req.method === 'GET') {
      const name = asset[1];
      const isPublic = PUBLIC_ADMIN_ASSETS.has(name), isPrivate = PRIVATE_ADMIN_ASSETS.has(name);
      if (!isPublic && !isPrivate) return notFound(res);
      if (isPrivate && !sessionOf(req)) return send(res, 401, 'Unauthorized', { 'Content-Type': 'text/plain' });
      return send(res, 200, readStatic(path.join(cfg.ADMIN_DIR, name)), { ...adminHeaders, 'Content-Type': MIME[path.extname(name)] });
    }
    if ((pathname === '/admin' || pathname === '/admin/') && req.method === 'GET') {
      if (!sessionOf(req)) return redirect(res, '/admin/login');
      return send(res, 200, readStatic(path.join(cfg.ADMIN_DIR, 'app.html')), { ...adminHeaders, 'Content-Type': MIME['.html'] });
    }

    if (pathname.startsWith('/api/admin/')) {
      const session = sessionOf(req);
      if (!session) return json(res, 401, { error: 'انتهت الجلسة. سجّل الدخول من جديد.' });
      if (req.method !== 'GET') {
        if (!originOk(req) || req.headers['x-csrf-token'] !== session.csrf) return json(res, 403, { error: 'طلب مرفوض' });
      }
      return adminApi(req, res, pathname, session);
    }
    return notFound(res);
  }

  /* ---------- public website ---------- */
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/' || pathname === '/index.html') {
      return send(res, 200, renderSite(), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP_SITE });
    }
    if (pathname === '/api/public') return json(res, 200, publicData());
  }
  return notFound(res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    if (res.headersSent) return res.end();
    json(res, status, { error: err.expose || status === 413 ? (status === 413 ? 'الملف كبير جدًا (الحد 6 ميجا)' : err.message) : 'حدث خطأ في الخادم' });
  });
});
server.requestTimeout = 60000;
server.headersTimeout = 30000;

const created = auth.ensureAdmin();
server.listen(cfg.PORT, cfg.HOST, () => {
  console.log(`\nCAPITAL RISE running on http://localhost:${cfg.PORT}   (admin: /admin)`);
  if (created) {
    console.log('\n================ FIRST RUN: ADMIN ACCOUNT CREATED ================');
    console.log(' username:', created.username);
    console.log(' password:', created.password || '(the ADMIN_PASSWORD you set in .env)');
    if (created.password) console.log(' >> Save this password now. It is shown only once. Change it from the dashboard.');
    console.log('===================================================================\n');
  }
});
