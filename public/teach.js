// REGAM Live - teacher sign-up: pick a plan, ask for an account, see how to pay.
'use strict';
(async function () {
  const data = await fetch('/api/plans').then((r) => r.json());
  const planLine = (p) => T('{name}: حتى ل {n} متابع، {price} دولار فالشهر', { name: p.name, n: p.capacity, price: p.price });
  $('#plans').append(...data.plans.map((p, i) => el('label', { class: 'plan' },
    el('input', { type: 'radio', name: 'planId', value: p.id, checked: i === 0, required: true }),
    el('span', {}, planLine(p)))));
  if (!data.plans.length) { $('#applyForm').hidden = true; }

  // ---- online payment (PayPal): right after the request, or later to renew
  const paid = new URLSearchParams(location.search).get('paid');
  if (paid) {
    const until = Number(new URLSearchParams(location.search).get('until')) || 0;
    const day = until ? new Date(until).toLocaleDateString(LANG === 'ar' ? 'ar-MA' : LANG, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    $('#paidMsg').hidden = false;
    $('#paidMsg').classList.add(paid === '1' ? 'ok' : 'bad');
    $('#paidMsg').textContent = paid === '1' ? T('وصل الخلاص، شكرا. الحساب ديالك خدام حتى ل {day}. دخل للاستوديو باسم الدخول وكلمة السر.', { day })
      : paid === 'cancel' ? T('تلغى الخلاص. ما تخلص والو.')
        : paid === 'wait' ? T('الخلاص مازال كيتراجع عند PayPal. ملي يتأكد، الإدارة غادي تفعل الحساب.')
          : T('الخلاص ما دازش. ما تخلص والو. عاود جرب ولا تواصل مع الإدارة.');
    history.replaceState(null, '', '/teach');
  }
  const monthsLabel = (n) => T(n === 1 ? 'شهر واحد' : n === 12 ? 'عام (12 شهر)' : '{n} شهور', { n });
  for (const sel of document.querySelectorAll('select[name=months]')) sel.replaceChildren(...(data.months || [1]).map((n) => el('option', { value: n }, monthsLabel(n))));
  $('#renewBox').hidden = !data.pay;
  const PAYERR = {
    'wrong login or password': 'اسم الدخول ولا كلمة السر غالطين.', 'too many attempts': 'محاولات بزاف. عاود من بعد شوية.',
    'account suspended': 'هاد الحساب موقوف. تواصل مع الإدارة.', 'no plan': 'هاد الحساب ما عندوش عرض. تواصل مع الإدارة.',
    'payment not set up': 'الخلاص أونلاين مازال ما مركبش.', 'paypal refused': 'PayPal ما جاوبش. عاود جرب من بعد شوية.',
  };
  async function payWith(login, password, months, btn, errEl) {
    btn.disabled = true;
    const r = await fetch('/api/pay/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password, months: Number(months) }) }).catch(() => null);
    const out = r ? await r.json().catch(() => ({})) : {};
    if (r && r.ok && out.url) { location.href = out.url; return; }
    btn.disabled = false;
    errEl.hidden = false; errEl.classList.add('bad');
    errEl.textContent = T(PAYERR[out.error] || 'ما قدرناش نديرو هاد العملية.');
  }
  $('#renewForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target.elements;
    payWith(f.login.value, f.password.value, f.months.value, e.target.querySelector('button'), $('#paidMsg'));
  };
  let applied = null;                              // the login and password just chosen, to pay right away

  const ERR = {
    'login already used': 'هاد اسم الدخول مستعمل.', 'password too short': 'كلمة السر خاصها 8 حروف ولا أكثر.',
    'bad name or login': 'اسم الدخول: 3 حروف ولا أكثر، حروف لاتينية وأرقام.', 'too many requests': 'طلبات بزاف. عاود من بعد ساعة.',
    'missing fields': 'عمر كاع الخانات.',
  };
  $('#applyForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const body = { planId: f.planId.value, name: f.name.value, contact: f.contact.value, roomTitle: f.roomTitle.value, topic: f.topic.value, login: f.login.value, password: f.password.value };
    const r = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      $('#applyErr').hidden = false;
      $('#applyErr').textContent = T(ERR[out.error] || 'ما قدرناش نديرو هاد العملية.');
      return;
    }
    applied = { login: body.login, password: body.password };
    $('#payNow').hidden = !out.pay; $('#renewBox').hidden = true;
    $('#payNow').onsubmit = (ev) => { ev.preventDefault(); payWith(applied.login, applied.password, ev.target.elements.months.value, ev.target.querySelector('button'), $('#paidMsg')); };
    $('#applyBox').hidden = true; $('#applyDone').hidden = false;
    $('#donePlan').textContent = planLine(out.plan);
    $('#payInfo').textContent = out.payInfo || T('طريقة الخلاص غادي توصلك من عند الإدارة.');
    scrollTo(0, 0);
  };
})();
