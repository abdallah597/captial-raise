(function () {
  var f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = ''; go.disabled = true; go.textContent = 'جارٍ الدخول...';
    fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.ok) { location.replace('/admin/'); return; }
        err.textContent = x.d.error || 'تعذر تسجيل الدخول';
        go.disabled = false; go.textContent = 'دخول';
      })
      .catch(function () { err.textContent = 'تعذر الاتصال بالخادم'; go.disabled = false; go.textContent = 'دخول'; });
  });
})();
