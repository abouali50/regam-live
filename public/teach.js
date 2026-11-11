// REGAM Live - teacher sign-up: pick a plan, ask for an account, see how to pay.
'use strict';
(async function () {
  const data = await fetch('/api/plans').then((r) => r.json());
  const planLine = (p) => T('{name}: حتى ل {n} متابع، {price} دولار فالشهر', { name: p.name, n: p.capacity, price: p.price });
  $('#plans').append(...data.plans.map((p, i) => el('label', { class: 'plan' },
    el('input', { type: 'radio', name: 'planId', value: p.id, checked: i === 0, required: true }),
    el('span', {}, planLine(p)))));
  if (!data.plans.length) { $('#applyForm').hidden = true; }

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
    $('#applyBox').hidden = true; $('#applyDone').hidden = false;
    $('#donePlan').textContent = planLine(out.plan);
    $('#payInfo').textContent = out.payInfo || T('طريقة الخلاص غادي توصلك من عند الإدارة.');
    scrollTo(0, 0);
  };
})();
