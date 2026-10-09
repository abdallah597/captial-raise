# CAPITAL RISE — الموقع + لوحة التحكم

مشروع كامل: **الموقع الرئيسي** (نفس التصميم بدون أي تغيير) + **لوحة تحكم /admin** بتسجيل دخول حقيقي + **قاعدة بيانات SQLite**.
بدون أي مكتبات خارجية (لا يوجد `npm install`). المطلوب فقط **Node.js 22.13 أو أحدث**.

> **جاهز للتشغيل:** ملف `.env` جاهز وفيه بيانات الدخول (راجع `LOGIN-دخول-الادمن.txt`). ارفع المجلد كما هو وشغّل `node server/index.js` ولا تحتاج تعديل أي شيء.

## التشغيل على جهازك
```bash
cp .env.example .env        # ثم ضع ADMIN_PASSWORD (10 أحرف على الأقل)
node server/index.js
```
- الموقع: http://localhost:3000
- لوحة التحكم: http://localhost:3000/admin

## الرفع على الاستضافة / الدومين
**الخيار 1 — VPS (Ubuntu) مع nginx**
1. ثبّت Node 22+ ثم ارفع المجلد (مثلًا `/var/www/capital-rise`) وأنشئ `.env`.
2. شغّله بشكل دائم: `npm i -g pm2 && pm2 start server/index.js --name capital-rise && pm2 save && pm2 startup`
3. nginx (ثم فعّل HTTPS بـ `certbot --nginx -d yourdomain.com`):
```nginx
server {
  server_name yourdomain.com www.yourdomain.com;
  client_max_body_size 8m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
4. في `.env` اجعل `TRUST_PROXY=1`.

**الخيار 2 — Railway / Render / Fly (أو أي استضافة Docker)**
استخدم الـ `Dockerfile` المرفق، وأضف **Volume دائم** مربوطًا بالمسار `/data` (هناك تُحفظ القاعدة والصور)، وضع المتغيرات `ADMIN_PASSWORD` و`TRUST_PROXY=1`. بدون Volume ستضيع البيانات عند كل نشر جديد.

## فصل لوحة التحكم عن الموقع
المجلدات منفصلة: `site/` (الموقع) و`admin/` (اللوحة) و`server/` (الخادم). ولو أردت لوحة على دومين فرعي:
ضع `ADMIN_HOST=admin.yourdomain.com` ووجّه الدومينين لنفس التطبيق؛ عندها لا تعمل اللوحة إلا على الدومين الفرعي، ويرجع أي طلب `/admin` على الدومين الرئيسي بـ 404.

## الأمان المطبّق
- كلمات المرور مشفّرة بـ scrypt، والجلسة كوكي `HttpOnly + SameSite=Strict` (و`Secure` تلقائيًا على HTTPS).
- `/admin` وملفات اللوحة وكل الـ API محمية بالجلسة، وكل عملية تعديل تحتاج رمز CSRF + فحص Origin.
- حظر مؤقت بعد 8 محاولات دخول خاطئة (15 دقيقة).
- الصور تُفحص من محتواها (PNG/JPG/WEBP/GIF فقط، حتى 6MB) وتُحفظ بأسماء عشوائية.
- لا يوجد أي كود أدمن داخل صفحة الموقع العامة، ولا يُخزَّن شيء في المتصفح.

## صيانة
- **نسخة احتياطية**: انسخ مجلد `data/` كاملًا (القاعدة + الصور).
- **نسيت كلمة المرور**: `node scripts/reset-password.js "كلمة-جديدة-قوية"`
- **تغيير الرقم / الخدمات / الشهادات**: من لوحة التحكم مباشرة، يظهر في الموقع فورًا.

## هيكل المشروع
```
server/   الخادم + قاعدة البيانات + الحماية
site/     قالب الموقع الرئيسي (التصميم الأصلي)
admin/    صفحات وسكربتات لوحة التحكم
scripts/  أدوات (إعادة كلمة المرور)
data/     قاعدة البيانات والصور المرفوعة (لا تُرفع على Git)
```
