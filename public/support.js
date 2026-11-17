// REGAM Live - the support page: answers to the usual questions, and a form to write to the people who run the site.
// Author: Aziz Mernissi.
'use strict';
(() => {
  const L = (ar, fr, en) => (LANG === 'fr' ? fr : LANG === 'en' ? en : ar);
  const qa = (q, a) => el('details', { class: 'faq' }, el('summary', {}, q), el('p', {}, a));
  const msg = el('p', { class: 'muted', role: 'status', hidden: true });
  const field = (label, input) => el('label', {}, label, input);
  const kind = el('select', { name: 'kind' },
    el('option', { value: 'question' }, L('سؤال', 'Question', 'Question')), el('option', { value: 'request' }, L('طلب', 'Demande', 'Request')),
    el('option', { value: 'complaint' }, L('شكاية', 'Réclamation', 'Complaint')), el('option', { value: 'pricing' }, L('الأثمنة والخلاص', 'Tarifs et paiement', 'Pricing and payment')),
    el('option', { value: 'technical' }, L('مشكل تقني', 'Problème technique', 'Technical problem')));
  const name = el('input', { name: 'name', type: 'text', maxlength: 60, required: true, autocomplete: 'name', value: account.name || '' });
  const email = el('input', { name: 'email', type: 'email', maxlength: 120, required: true, autocomplete: 'email', dir: 'ltr' });
  const text = el('textarea', { name: 'text', rows: 6, maxlength: 3000, required: true, minlength: 10, dir: 'auto' });
  const send = el('button', { class: 'btn primary', type: 'submit' }, L('صيفط', 'Envoyer', 'Send'));
  const form = el('form', { class: 'admin-form support-form', id: 'supportForm', onsubmit: async (e) => {
    e.preventDefault(); send.disabled = true;
    const r = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind.value, name: name.value, email: email.value, text: text.value }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    send.disabled = false; msg.hidden = false;
    if (r && r.ok) { text.value = ''; msg.classList.remove('bad'); msg.textContent = L('وصلات الرسالة ديالك. الرقم ديالها: {id}. غادي نجاوبوك بالإيميل.', 'Votre message est bien arrivé. Son numéro : {id}. Nous vous répondrons par e-mail.', 'Your message has arrived. Its number: {id}. We will answer by e-mail.').replace('{id}', d.id); }
    else { msg.classList.add('bad'); msg.textContent = r && r.status === 429 ? L('صيفطتي رسائل بزاف. عاود من بعد ساعة.', 'Trop de messages envoyés. Réessayez dans une heure.', 'Too many messages sent. Try again in an hour.') : L('ما تصيفطاتش. تأكد من الإيميل واكتب عشرة ديال الحروف على الأقل.', 'Message non envoyé. Vérifiez l’e-mail et écrivez au moins dix caractères.', 'Not sent. Check the e-mail and write at least ten characters.'); }
  } }, field(L('النوع', 'Sujet', 'Subject'), kind), field(L('الاسم', 'Nom', 'Name'), name), field(L('الإيميل ديالك', 'Votre e-mail', 'Your e-mail'), email), el('label', { class: 'wide' }, L('الرسالة', 'Message', 'Message'), text), send);

  document.getElementById('supportMain').append(
    el('section', { class: 'hero' }, el('h1', {}, L('كيفاش نقدرو نعاونوك؟', 'Comment pouvons-nous vous aider ?', 'How can we help?')),
      el('p', {}, L('الأجوبة ديال الأسئلة المعروفة، ومن بعد اكتب لينا: سؤال، طلب، شكاية ولا مشكل تقني.', 'Les réponses aux questions courantes, puis écrivez-nous : question, demande, réclamation ou problème technique.', 'Answers to the usual questions, then write to us: a question, a request, a complaint or a technical problem.'))),
    el('section', { class: 'site-sec' }, el('h2', { class: 'home-title' }, L('أسئلة معروفة', 'Questions fréquentes', 'Frequent questions')),
      qa(L('كيفاش ندخل للايف؟', 'Comment entrer dans un live ?', 'How do I enter a live?'), L('كليكي على الرابط اللي صيفط ليك المنظم. الكود راه فالرابط، ما كتكتب والو.', 'Cliquez sur le lien envoyé par l’organisateur. Le code est dans le lien, vous n’avez rien à taper.', 'Open the link the organiser sent you. The code is in the link, there is nothing to type.')),
      qa(L('ما وصلنيش إيميل التأكيد.', 'Je n’ai pas reçu l’e-mail de validation.', 'I did not get the validation e-mail.'), L('شوف فدوسي Spam. من بعد كليكي على الرابط اللي فالإيميل، ولا اكتب الكود: واحد منهم كافي.', 'Regardez dans le dossier Spam. Ensuite cliquez sur le lien de l’e-mail, ou tapez le code : l’un des deux suffit.', 'Look in the Spam folder. Then open the link in the e-mail, or type the code: either one is enough.')),
      qa(L('ما كنسمعش ولا ما كنشوفش.', 'Je n’entends pas ou je ne vois pas.', 'I cannot hear or see.'), L('عاود حمل الصفحة، طلع الصوت، وجرب Chrome ولا Safari محدث. فالآيفون كليكي على الفيديو باش يبدا الصوت.', 'Rechargez la page, montez le son et essayez Chrome ou Safari à jour. Sur iPhone, touchez la vidéo pour lancer le son.', 'Reload the page, turn the sound up and try an up-to-date Chrome or Safari. On iPhone, tap the video to start the sound.')),
      qa(L('كيفاش نهضر فاللايف؟', 'Comment prendre la parole ?', 'How do I speak in the live?'), L('كليكي على «طلب الكلمة». ملي يقبلك المنظم كيبانو ليك أزرار الميكرو والكاميرا.', 'Touchez « Demander la parole ». Quand l’organisateur accepte, vos boutons Micro et Caméra apparaissent.', 'Tap “Ask to speak”. When the organiser accepts, your Mic and Camera buttons appear.')),
      qa(L('كيفاش ندير اللايفات ديالي؟', 'Comment animer mes propres lives ?', 'How do I run my own lives?'), L('كري حساب مهني من صفحة الأثمنة، اختار العرض، ومن بعد دخل للاستوديو.', 'Créez un compte professionnel depuis les tarifs, choisissez une offre, puis entrez dans le studio.', 'Open a professional account from the pricing, choose a plan, then go to the studio.')),
      qa(L('شنو طرق الخلاص؟', 'Quels sont les moyens de paiement ?', 'What are the ways to pay?'), L('PayPal ولا الكارط، ولا محفظة كريبتو (USDT ولا USDC على BNB Smart Chain) إلا كانت مفعلة.', 'PayPal ou carte bancaire, ou un wallet crypto (USDT ou USDC sur BNB Smart Chain) lorsqu’il est activé.', 'PayPal or card, or a crypto wallet (USDT or USDC on BNB Smart Chain) when it is turned on.')),
      qa(L('كيفاش نثبت التطبيق؟', 'Comment installer l’application ?', 'How do I install the app?'), L('شوف القسم «التطبيق» فالصفحة الرئيسية: Windows، Mac، iPhone و Android.', 'Voyez la rubrique « Application » de la page d’accueil : Windows, Mac, iPhone et Android.', 'See the “App” section of the home page: Windows, Mac, iPhone and Android.')),
      qa(L('كيفاش نمسح الحساب ديالي؟', 'Comment supprimer mon compte ?', 'How do I delete my account?'), L('حل البروفايل ديالك، ومن بعد «حذف الحساب». ولا اكتب لينا من هنا.', 'Ouvrez votre profil, puis « Supprimer le compte ». Ou écrivez-nous ici.', 'Open your profile, then “Delete the account”. Or write to us here.'))),
    el('section', { class: 'site-sec', id: 'contact' }, el('h2', { class: 'home-title' }, L('اكتب لينا', 'Écrivez-nous', 'Write to us')),
      el('p', { class: 'site-lead' }, L('غادي نجاوبوك بالإيميل.', 'Nous vous répondrons par e-mail.', 'We will answer by e-mail.')), form, msg));
  fetch('/api/site').then((r) => r.json()).then((site) => { mountAccount(document.querySelector('.top .meta'), site); if (site.assistant) mountAssistant(); }).catch(() => {});
})();
