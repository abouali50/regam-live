// REGAM Live - terms of use and privacy, in the reader's language, and "delete my account".
'use strict';
(function () {
  const lang = ['fr', 'en', 'ar'].includes(LANG) ? LANG : 'fr';
  for (const a of document.querySelectorAll('article[data-lang]')) a.hidden = a.dataset.lang !== lang;
  fetch('/api/site').then((r) => r.json()).then((site) => {
    document.title = site.site;
    mountAccount(document.querySelector('.top .meta'), site);
    const who = site.legal || {};
    $('#legalWho').hidden = !who.owner && !who.contact;
    $('#legalWho').textContent = [who.owner ? T('المسؤول على الموقع: {owner}', { owner: who.owner }) : '', who.contact ? T('للتواصل: {contact}', { contact: who.contact }) : ''].filter(Boolean).join(' · ');
  }).catch(() => {});
  $('#delBox').hidden = !account.token;
  $('#delForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm(T('تحذف الحساب ديالك نهائيا؟ ما يمكنش ترجع فيه.'))) return;
    const r = await fetch('/api/member/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + account.token }, body: JSON.stringify({ password: e.target.elements.password.value }) }).catch(() => null);
    if (r && r.ok) { account.clear(); $('#delForm').hidden = true; $('#delMsg').className = 'ok-text'; $('#delMsg').textContent = T('تحذف الحساب ديالك.'); return; }
    $('#delMsg').textContent = T(r && r.status === 401 ? 'كلمة السر غالطة.' : 'ما قدرناش نديرو هاد العملية.');
  };
})();
