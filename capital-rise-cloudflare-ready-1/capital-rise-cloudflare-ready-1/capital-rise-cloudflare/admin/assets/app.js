(function () {
  'use strict';
  var CSRF = '';
  var view = document.getElementById('view');
  var tabsEl = document.getElementById('tabs');
  var TAB = 'services';

  /* ---------- tiny DOM helper (text is always set via textContent: no XSS) ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var NS = 'http://www.w3.org/2000/svg';
  var ICON_PATHS = {
    i1: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 8h6M9 12h6M9 16h3"/><circle cx="16.5" cy="17" r="2.2"/>',
    i2: '<circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/>',
    i3: '<path d="M6 8V4h9l3 3v1"/><rect x="4" y="8" width="16" height="7" rx="1"/><rect x="6.5" y="15" width="11" height="6"/>',
    i4: '<path d="M3 7h7l2 2h9v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/><path d="M8 13h8M8 16h5"/>',
    i5: '<rect x="4" y="9" width="7" height="12"/><rect x="13" y="4" width="7" height="17"/><path d="M6.5 12h2M6.5 15h2M15.5 7h2M15.5 10h2M15.5 13h2"/>',
    i6: '<circle cx="9" cy="8" r="3"/><path d="M4 20c0-3.3 2.2-5.5 5-5.5s5 2.2 5 5.5"/><rect x="15.5" y="6" width="5.5" height="7.5" rx=".8"/>',
    ck: '<circle cx="12" cy="12" r="9.3"/><path d="M8 12.3l2.6 2.6L16.3 9"/>'
  };
  var ICON_NAMES = { i1: 'مستند', i2: 'متابعة', i3: 'طباعة', i4: 'ملفات', i5: 'شركات', i6: 'أفراد', ck: 'علامة صح' };
  function icon(key) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    var doc = new DOMParser().parseFromString('<svg xmlns="' + NS + '">' + (ICON_PATHS[key] || ICON_PATHS.i1) + '</svg>', 'image/svg+xml');
    Array.prototype.forEach.call(doc.documentElement.childNodes, function (n) { svg.appendChild(document.importNode(n, true)); });
    return svg;
  }

  /* ---------- feedback ---------- */
  var toastT;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, bad ? 4200 : 2200);
  }

  /* ---------- API ---------- */
  function api(method, url, body, raw) {
    var opt = { method: method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') opt.headers['X-CSRF-Token'] = CSRF;
    if (raw) { opt.body = raw; opt.headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    return fetch(url, opt).then(function (r) {
      if (r.status === 401) { location.replace('/admin/login.html'); return Promise.reject(new Error('session')); }
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) return Promise.reject(new Error(d.error || 'حدث خطأ'));
        return d;
      });
    });
  }
  function fail(e) { if (e && e.message !== 'session') toast(e.message || 'حدث خطأ', true); }

  /* ---------- modal ---------- */
  function modal(title, bodyEls, onSave, saveLabel) {
    var err = h('div', { class: 'err', role: 'alert' });
    var save = h('button', { class: 'btn primary', type: 'button', text: saveLabel || 'حفظ' });
    var cancel = h('button', { class: 'btn', type: 'button', text: 'إلغاء' });
    var box = h('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' },
      [h('h2', { text: title })].concat(bodyEls, [err, h('div', { class: 'modal-foot' }, [save, cancel])]));
    var wrap = h('div', { class: 'modal' }, [box]);
    function close() { document.body.removeChild(wrap); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    cancel.addEventListener('click', close);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', esc);
    save.addEventListener('click', function () {
      err.textContent = ''; save.disabled = true;
      Promise.resolve(onSave()).then(function () { close(); }, function (e) {
        save.disabled = false; err.textContent = (e && e.message) || 'حدث خطأ';
      });
    });
    document.body.appendChild(wrap);
    var first = box.querySelector('input,textarea'); if (first) first.focus();
  }
  function confirmBox(title, text, okLabel, onOk) {
    var ok = h('button', { class: 'btn danger', type: 'button', text: okLabel });
    var cancel = h('button', { class: 'btn', type: 'button', text: 'إلغاء' });
    var box = h('div', { class: 'modal-box', role: 'alertdialog', 'aria-modal': 'true' },
      [h('h2', { text: title }), h('p', { class: 'hint', text: text }), h('div', { class: 'modal-foot' }, [ok, cancel])]);
    var wrap = h('div', { class: 'modal' }, [box]);
    function close() { document.body.removeChild(wrap); }
    cancel.addEventListener('click', close);
    ok.addEventListener('click', function () { ok.disabled = true; Promise.resolve(onOk()).then(close, function (e) { close(); fail(e); }); });
    document.body.appendChild(wrap);
  }
  function field(label, el, hint) {
    return h('div', null, [h('label', { class: 'f', text: label }), el, hint ? h('p', { class: 'hint', text: hint }) : null]);
  }

  /* =====================================================================
     Services
     ===================================================================== */
  function renderServices() {
    api('GET', '/api/admin/services').then(function (list) {
      view.textContent = '';
      view.appendChild(h('div', { class: 'sec-head' }, [
        h('div', null, [h('h2', { text: 'الخدمات' }), h('div', { class: 'count', text: 'عدد الخدمات: ' + list.length })]),
        h('button', { class: 'btn primary', type: 'button', text: '+ إضافة خدمة جديدة', onclick: function () { serviceForm(null); } })
      ]));
      if (!list.length) view.appendChild(h('div', { class: 'empty', text: 'لا توجد خدمات. اضغط "إضافة خدمة جديدة".' }));
      list.forEach(function (s, i) {
        var acts = h('div', { class: 'acts' }, [
          h('button', { class: 'btn sm', type: 'button', text: 'تعديل', onclick: function () { serviceForm(s); } }),
          h('button', { class: 'btn sm', type: 'button', text: s.visible ? 'إخفاء من الموقع' : 'إظهار في الموقع', onclick: function () {
            api('PUT', '/api/admin/services/' + s.id, { visible: !s.visible }).then(function () { toast(s.visible ? 'تم إخفاء الخدمة' : 'تم إظهار الخدمة'); renderServices(); }, fail);
          } }),
          h('button', { class: 'btn sm', type: 'button', text: '▲', 'aria-label': 'للأعلى', disabled: i === 0, onclick: function () { move(s.id, 'up'); } }),
          h('button', { class: 'btn sm', type: 'button', text: '▼', 'aria-label': 'للأسفل', disabled: i === list.length - 1, onclick: function () { move(s.id, 'down'); } }),
          h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () {
            confirmBox('حذف الخدمة', 'سيتم حذف "' + s.title + '" نهائيًا من الموقع. هل أنت متأكد؟', 'نعم، احذف', function () {
              return api('DELETE', '/api/admin/services/' + s.id).then(function () { toast('تم حذف الخدمة'); renderServices(); });
            });
          } })
        ]);
        view.appendChild(h('div', { class: 'card' + (s.visible ? '' : ' hiddenitem') }, [
          h('div', { class: 'row' }, [
            h('div', { class: 'ico' }, [icon(s.icon)]),
            h('div', { class: 'grow' }, [
              h('h3', null, [s.title, h('span', { class: 'badge ' + (s.visible ? 'on' : 'off'), text: s.visible ? 'ظاهرة' : 'مخفية' })]),
              h('p', { text: s.description })
            ])
          ]), acts
        ]));
      });
    }, fail);
    function move(id, dir) { api('POST', '/api/admin/services/' + id + '/move', { dir: dir }).then(renderServices, fail); }
  }

  function serviceForm(s) {
    var title = h('input', { class: 'inp', maxlength: '120', value: s ? s.title : '', placeholder: 'مثال: تخليص المعاملات الحكومية' });
    var desc = h('textarea', { class: 'inp', maxlength: '1000', placeholder: 'مثال: تخليص ومتابعة الإجراءات الحكومية بسهولة واحترافية.' });
    desc.value = s ? s.description : '';
    var chosen = s ? s.icon : 'i1';
    var picks = h('div', { class: 'icons' });
    function drawPicks() {
      picks.textContent = '';
      Object.keys(ICON_NAMES).forEach(function (k) {
        var b = h('button', { class: 'icopick' + (k === chosen ? ' on' : ''), type: 'button', title: ICON_NAMES[k], 'aria-label': ICON_NAMES[k], onclick: function () { chosen = k; drawPicks(); } }, [h('div', { class: 'ico' }, [icon(k)])]);
        picks.appendChild(b);
      });
    }
    drawPicks();
    var vis = h('input', { type: 'checkbox', checked: s ? s.visible : true });
    modal(s ? 'تعديل الخدمة' : 'إضافة خدمة جديدة', [
      field('اسم الخدمة', title),
      field('الوصف والتفاصيل (يظهر تحت اسم الخدمة)', desc),
      h('div', null, [h('label', { class: 'f', text: 'الأيقونة' }), picks]),
      h('label', { class: 'chk' }, [vis, 'إظهار هذه الخدمة في الموقع']),
      h('p', { class: 'hint', text: 'زر "ابدأ الطلب" يفتح واتساب تلقائيًا على الرقم المسجل في إعدادات التواصل.' })
    ], function () {
      var payload = { title: title.value, description: desc.value, icon: chosen, visible: vis.checked };
      return (s ? api('PUT', '/api/admin/services/' + s.id, payload) : api('POST', '/api/admin/services', payload))
        .then(function () { toast('تم الحفظ — التعديل ظاهر الآن في الموقع'); renderServices(); });
    });
  }

  /* =====================================================================
     Certificates
     ===================================================================== */
  function renderCerts() {
    api('GET', '/api/admin/certificates').then(function (list) {
      view.textContent = '';
      view.appendChild(h('div', { class: 'sec-head' }, [
        h('div', null, [h('h2', { text: 'شهاداتنا' }), h('div', { class: 'count', text: 'عدد الشهادات: ' + list.length })]),
        h('button', { class: 'btn primary', type: 'button', text: '+ رفع شهادة جديدة', onclick: function () { certForm(null); } })
      ]));
      if (!list.length) { view.appendChild(h('div', { class: 'empty', text: 'لا توجد شهادات. عند عدم وجود شهادات ظاهرة، يختفي قسم "شهاداتنا" من الموقع.' })); return; }
      var grid = h('div', { class: 'grid' });
      list.forEach(function (c, i) {
        var im = h('div', { class: 'im' }, [c.image ? h('img', { src: c.image, alt: c.title, loading: 'lazy' }) : '✦']);
        grid.appendChild(h('div', { class: 'cert' + (c.visible ? '' : ' hiddenitem') }, [im,
          h('div', { class: 'bd' }, [
            h('h3', null, [c.title || 'بدون عنوان', h('span', { class: 'badge ' + (c.visible ? 'on' : 'off'), text: c.visible ? 'ظاهرة' : 'مخفية' })]),
            c.description ? h('p', { text: c.description }) : null,
            h('div', { class: 'acts' }, [
              h('button', { class: 'btn sm', type: 'button', text: 'تعديل', onclick: function () { certForm(c); } }),
              h('button', { class: 'btn sm', type: 'button', text: c.visible ? 'إخفاء' : 'إظهار', onclick: function () {
                api('PUT', '/api/admin/certificates/' + c.id, { visible: !c.visible }).then(function () { toast(c.visible ? 'تم إخفاء الشهادة' : 'تم إظهار الشهادة'); renderCerts(); }, fail);
              } }),
              h('button', { class: 'btn sm', type: 'button', text: '▲', 'aria-label': 'للأمام', disabled: i === 0, onclick: function () { move(c.id, 'up'); } }),
              h('button', { class: 'btn sm', type: 'button', text: '▼', 'aria-label': 'للخلف', disabled: i === list.length - 1, onclick: function () { move(c.id, 'down'); } }),
              h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () {
                confirmBox('حذف الشهادة', 'سيتم حذف الشهادة وصورتها نهائيًا. هل أنت متأكد؟', 'نعم، احذف', function () {
                  return api('DELETE', '/api/admin/certificates/' + c.id).then(function () { toast('تم حذف الشهادة'); renderCerts(); });
                });
              } })
            ])
          ])
        ]));
      });
      view.appendChild(grid);
    }, fail);
    function move(id, dir) { api('POST', '/api/admin/certificates/' + id + '/move', { dir: dir }).then(renderCerts, fail); }
  }

  function certForm(c) {
    var file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'inp' });
    var preview = h('div', { class: 'preview' }, [c && c.image ? h('img', { src: c.image, alt: '' }) : 'لم يتم اختيار صورة بعد']);
    var picked = null;
    file.addEventListener('change', function () {
      picked = file.files[0] || null;
      if (!picked) return;
      if (picked.size > 6 * 1024 * 1024) { toast('الصورة أكبر من 6 ميجا. اختر صورة أصغر', true); file.value = ''; picked = null; return; }
      preview.textContent = '';
      var img = h('img', { alt: '' }); img.src = URL.createObjectURL(picked); preview.appendChild(img);
    });
    var title = h('input', { class: 'inp', maxlength: '120', value: c ? c.title : '', placeholder: 'اختياري — مثال: شهادة تقدير 2026' });
    var desc = h('textarea', { class: 'inp', maxlength: '600', placeholder: 'اختياري' }); desc.value = c ? c.description : '';
    var vis = h('input', { type: 'checkbox', checked: c ? c.visible : true });
    modal(c ? 'تعديل الشهادة' : 'رفع شهادة جديدة', [
      h('div', null, [h('label', { class: 'f', text: c ? 'صورة الشهادة (اختر صورة جديدة فقط إذا أردت تغييرها)' : 'صورة الشهادة' }), file, preview]),
      field('العنوان (اختياري)', title),
      field('الوصف (اختياري)', desc),
      h('label', { class: 'chk' }, [vis, 'إظهار هذه الشهادة في الموقع'])
    ], function () {
      if (!c && !picked) return Promise.reject(new Error('اختر صورة الشهادة أولًا'));
      var upload = picked
        ? picked.arrayBuffer().then(function (buf) { return api('POST', '/api/admin/upload', undefined, buf); }).then(function (r) { return r.url; })
        : Promise.resolve(c.image);
      return upload.then(function (url) {
        var payload = { title: title.value, description: desc.value, image: url, visible: vis.checked };
        return c ? api('PUT', '/api/admin/certificates/' + c.id, payload) : api('POST', '/api/admin/certificates', payload);
      }).then(function () { toast('تم الحفظ — الشهادة ظاهرة الآن في الموقع'); renderCerts(); });
    });
  }

  /* =====================================================================
     Contact / WhatsApp settings
     ===================================================================== */
  function renderSettings() {
    api('GET', '/api/admin/settings').then(function (st) {
      view.textContent = '';
      view.appendChild(h('div', { class: 'sec-head' }, [h('h2', { text: 'إعدادات التواصل / WhatsApp' })]));

      var wa = h('input', { class: 'inp', inputmode: 'numeric', dir: 'ltr', value: st.whatsapp_number, placeholder: '971541494114' });
      var msg = h('input', { class: 'inp', maxlength: '300', value: st.wa_message });
      var test = h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', text: 'تجربة الرقم الآن' });
      function syncTest() { var d = wa.value.replace(/\D/g, ''); test.href = d ? 'https://wa.me/' + d : '#'; }
      wa.addEventListener('input', syncTest); syncTest();

      var phone = h('input', { class: 'inp', dir: 'ltr', value: st.phone, maxlength: '40' });
      var email = h('input', { class: 'inp', dir: 'ltr', type: 'email', value: st.email, maxlength: '150' });
      var addr = h('input', { class: 'inp', value: st.address, maxlength: '200' });
      var hours = h('input', { class: 'inp', value: st.hours, maxlength: '120' });

      var socRows = st.socials.map(function (p) {
        var url = h('input', { class: 'inp', dir: 'ltr', placeholder: 'https://...', value: p.url, maxlength: '300' });
        var on = h('input', { type: 'checkbox', checked: p.on });
        return { key: p.key, url: url, on: on, node: h('div', { class: 'soc-row' }, [h('span', { class: 'nm', text: p.name }), url, h('label', { class: 'chk' }, [on, 'إظهار'])]) };
      });

      var save = h('button', { class: 'btn primary block', type: 'button', text: 'حفظ الإعدادات', onclick: function () {
        save.disabled = true;
        api('PUT', '/api/admin/settings', {
          whatsapp_number: wa.value, wa_message: msg.value, phone: phone.value, email: email.value, address: addr.value, hours: hours.value,
          socials: socRows.map(function (r) { return { key: r.key, url: r.url.value, on: r.on.checked }; })
        }).then(function () { toast('تم الحفظ — يعمل الرقم الجديد في كل أزرار الموقع'); renderSettings(); }, function (e) { save.disabled = false; fail(e); });
      } });

      view.appendChild(h('div', { class: 'set-card' }, [
        h('h3', { text: 'رقم WhatsApp' }),
        field('الرقم (مع كود الدولة، بدون + أو مسافات)', wa, 'الأزرار "ابدأ معاملتك الآن" و"ابدأ الطلب" و"تواصل معنا الآن" كلها تفتح واتساب على هذا الرقم.'),
        h('div', { class: 'acts' }, [test]),
        field('الرسالة الجاهزة عند فتح المحادثة (اختياري)', msg, 'زر "ابدأ الطلب" داخل كل خدمة يضيف اسم الخدمة تلقائيًا.'),
        h('h3', { text: 'بيانات إضافية (اختيارية)' }),
        h('p', { class: 'hint', text: 'تظهر في قسم التواصل بالموقع إذا كتبتها، وتختفي إذا تركتها فارغة.' }),
        field('رقم الهاتف', phone), field('البريد الإلكتروني', email), field('العنوان', addr), field('ساعات العمل', hours),
        h('details', { class: 'more' }, [h('summary', { text: 'روابط السوشيال ميديا (اختياري)' }),
          h('p', { class: 'hint', text: 'الأيقونة تظهر في الموقع فقط إذا كتبت الرابط وكانت مفعّلة.' })].concat(socRows.map(function (r) { return r.node; }))),
        save
      ]));

      var cur = h('input', { class: 'inp', type: 'password', autocomplete: 'current-password' });
      var nw = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password' });
      var pbtn = h('button', { class: 'btn block', type: 'button', text: 'تغيير كلمة المرور', onclick: function () {
        pbtn.disabled = true;
        api('POST', '/api/admin/password', { current: cur.value, next: nw.value }).then(function () { cur.value = ''; nw.value = ''; pbtn.disabled = false; toast('تم تغيير كلمة المرور'); }, function (e) { pbtn.disabled = false; fail(e); });
      } });
      view.appendChild(h('div', { class: 'set-card' }, [
        h('h3', { text: 'كلمة مرور لوحة التحكم' }),
        field('كلمة المرور الحالية', cur), field('كلمة المرور الجديدة (10 أحرف على الأقل)', nw), pbtn
      ]));
    }, fail);
  }

  /* =====================================================================
     Shell
     ===================================================================== */
  var TABS = [['services', 'الخدمات', renderServices], ['certs', 'شهاداتنا', renderCerts], ['settings', 'إعدادات التواصل / WhatsApp', renderSettings]];
  function drawTabs() {
    tabsEl.textContent = '';
    TABS.forEach(function (t) {
      tabsEl.appendChild(h('button', { class: 'tab' + (t[0] === TAB ? ' on' : ''), type: 'button', text: t[1], onclick: function () { TAB = t[0]; drawTabs(); t[2](); } }));
    });
  }
  document.getElementById('logout').addEventListener('click', function () {
    api('POST', '/api/admin/logout', {}).then(function () { location.replace('/admin/login.html'); }, function () { location.replace('/admin/login.html'); });
  });
  api('GET', '/api/admin/me').then(function (me) { CSRF = me.csrf; drawTabs(); renderServices(); }, fail);
})();
