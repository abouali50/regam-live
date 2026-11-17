// REGAM Live - the public site: menu, what the service does, who it is for, prices, the app on every device,
// the foot of the page. Used by the home page and the support page. Author: Aziz Mernissi.
'use strict';
(() => {
  const L = (ar, fr, en) => (LANG === 'fr' ? fr : LANG === 'en' ? en : ar);
  const home = location.pathname === '/' || location.pathname === '/rooms';
  const at = (hash) => (home ? hash : '/' + hash);

  // ---------------------------------------------------------------- menu --
  const drop = (label, items) => el('details', { class: 'nav-drop' }, el('summary', {}, label),
    el('div', { class: 'nav-menu' }, ...items.map(([text, href, note]) => el('a', { href }, el('strong', {}, text), note ? el('span', {}, note) : ''))));
  const nav = el('nav', { class: 'site-nav', 'aria-label': 'site' },
    el('a', { href: at('#features') }, L('المميزات', 'Fonctionnalités', 'Features')),
    el('a', { href: at('#solutions') }, L('الحلول', 'Solutions', 'Solutions')),
    el('a', { href: at('#pricing') }, L('الأثمنة', 'Tarifs', 'Pricing')),
    el('a', { href: at('#install') }, L('التطبيق', 'Application', 'App')),
    el('a', { href: '/support' }, L('الدعم', 'Support', 'Support')),
    drop(L('اللايف', 'Live', 'Meet'), [
      [L('حضر لايف', 'Rejoindre un live', 'Join a live'), at('#join'), L('بالرابط اللي وصلك', 'avec le lien reçu', 'with the link you received')],
      [L('دير لايف', 'Animer un live', 'Host a live'), '/studio', L('الاستوديو', 'le studio', 'the studio')],
      [L('برمج لايف', 'Programmer un live', 'Schedule a live'), '/studio', L('الأجندة', 'l’agenda', 'the agenda')],
      [L('كري حساب مهني', 'Créer un compte professionnel', 'Open a professional account'), '/teach', ''],
    ]));
  const brand = document.querySelector('.top .brand');
  if (brand) brand.after(nav);
  document.addEventListener('click', (e) => { for (const d of document.querySelectorAll('.nav-drop[open]')) if (!d.contains(e.target)) d.open = false; });

  // ------------------------------------------------- the app, everywhere --
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  const installNow = async (btn, note) => {
    if (installEvent) { installEvent.prompt(); installEvent = null; return; }
    note.hidden = false;
    note.textContent = window.matchMedia('(display-mode: standalone)').matches
      ? L('التطبيق راه مثبت فهاد الجهاز.', 'L’application est déjà installée sur cet appareil.', 'The app is already installed on this device.')
      : L('تبع الطريقة ديال الجهاز ديالك اللي تحت.', 'Suivez ci-dessous les étapes de votre appareil.', 'Follow the steps for your device below.');
  };

  if (home) {
    const main = document.querySelector('.home-main'), before = document.getElementById('proBox');
    const section = (id, title, lead, ...kids) => el('section', { id, class: 'site-sec' }, el('h2', { class: 'home-title' }, title), lead ? el('p', { class: 'site-lead' }, lead) : '', ...kids);
    const cards = (list) => el('div', { class: 'site-grid' }, ...list.map(([icon, title, text]) => el('article', { class: 'site-card' }, el('span', { class: 'site-ico', 'aria-hidden': 'true' }, icon), el('h3', {}, title), el('p', {}, text))));

    const features = section('features', L('كلشي باش دير لايف ناجح', 'Tout pour réussir vos lives', 'Everything for a great live'),
      L('أدوات ديال المحترفين، فالمتصفح، بلا ما تثبت والو.', 'Des outils de professionnel, dans le navigateur, sans rien installer.', 'Professional tools, in the browser, nothing to install.'),
      cards([
        ['🎥', L('لايف بجودة عالية', 'Live en haute qualité', 'High-quality live'), L('صوت وصورة واضحين لمئات المتابعين فنفس الوقت.', 'Son et image nets pour des centaines de spectateurs en même temps.', 'Clear sound and picture for hundreds of viewers at once.')],
        ['🎤', L('ضيوف على المنصة', 'Invités sur scène', 'Guests on stage'), L('حتى ل 12 ضيف بالكاميرا والميكرو، بطلب وموافقة.', 'Jusqu’à 12 invités avec caméra et micro, sur demande et accord.', 'Up to 12 guests with camera and mic, on request and approval.')],
        ['📝', L('سبورة ووثائق', 'Tableau blanc et documents', 'Whiteboard and documents'), L('كتب، رسم، وحل PDF، Word، فيديو وصوت قدام الجميع.', 'Écrivez, dessinez et ouvrez PDF, Word, vidéo et audio devant tous.', 'Write, draw and open PDF, Word, video and audio for everyone.')],
        ['🖥️', L('مشاركة الشاشة', 'Partage d’écran', 'Screen sharing'), L('ورّي الشاشة ديالك مع الصوت ديالها.', 'Montrez votre écran, avec son.', 'Show your screen, with its sound.')],
        ['🌍', L('ترجمة مباشرة', 'Traduction en direct', 'Live translation'), L('كتابة تحت الفيديو وصوت مترجم بلغات بزاف.', 'Sous-titres et voix traduite dans plusieurs langues.', 'Captions and a translated voice in several languages.')],
        ['⏺️', L('تسجيل وإعادة', 'Enregistrement et rediffusion', 'Recording and replay'), L('سجل اللايف وخلي التلاميذ يعاودو يشوفوه.', 'Enregistrez le live et laissez vos élèves le revoir.', 'Record the live and let your students watch it again.')],
        ['🗓️', L('أجندة وروابط خاصة', 'Agenda et liens privés', 'Agenda and private links'), L('برمج اللايفات، كل واحد برابط وكود ديالو.', 'Programmez vos lives, chacun avec son lien et son code.', 'Schedule lives, each with its own link and code.')],
        ['🎓', L('أقسام بالخلاص', 'Classes payantes', 'Paid classes'), L('دروس فابور ولا بالخلاص، حضور، وتذكير بالإيميل.', 'Cours gratuits ou payants, feuilles de présence et rappels par e-mail.', 'Free or paid classes, attendance sheets and e-mail reminders.')],
        ['❓', L('أسئلة واستطلاعات', 'Questions et sondages', 'Questions and polls'), L('الأسئلة فلائحة بوحدها، واستطلاع بكليك.', 'Les questions dans leur propre liste, un sondage en un clic.', 'Questions in their own list, a poll in one click.')],
        ['🌄', L('خلفية افتراضية', 'Fond virtuel', 'Virtual background'), L('صور وفيديوهات زوينة موراك، ولا الخلفية ديالك.', 'De belles images et vidéos derrière vous, ou les vôtres.', 'Beautiful pictures and videos behind you, or your own.')],
        ['📡', L('فيسبوك ويوتيوب', 'Facebook et YouTube', 'Facebook and YouTube'), L('نفس اللايف كيدوز حتى فالصفحات ديالك.', 'Le même live diffusé aussi sur vos pages.', 'The same live also sent to your pages.')],
        ['🔐', L('أمان وخصوصية', 'Sécurité et confidentialité', 'Security and privacy'), L('كود الدخول، قاعة انتظار، Face ID، ولايفات خاصة.', 'Code d’entrée, salle d’attente, Face ID et lives privés.', 'Entry code, waiting room, Face ID and private lives.')],
      ]));

    const solutions = section('solutions', L('حل لكل استعمال', 'Une solution pour chaque usage', 'A solution for every use'), '',
      cards([
        ['🏫', L('التعليم والدروس', 'Enseignement et cours', 'Teaching and classes'), L('مدارس، أساتذة، دروس الدعم والتكوين.', 'Écoles, professeurs, soutien scolaire et formation.', 'Schools, teachers, tutoring and training.')],
        ['🧭', L('الكوتشينغ', 'Coaching', 'Coaching'), L('حصص فردية ولا جماعية، مع الخلاص أونلاين.', 'Séances individuelles ou en groupe, avec paiement en ligne.', 'One-to-one or group sessions, with online payment.')],
        ['🤝', L('الاجتماعات', 'Réunions', 'Meetings'), L('اجتماعات الجمعيات، الشركات والفرق.', 'Réunions d’associations, d’entreprises et d’équipes.', 'Meetings for associations, companies and teams.')],
        ['🎙️', L('المحاضرات والندوات', 'Conférences et webinaires', 'Talks and webinars'), L('جمهور كبير، أسئلة منظمة، وإعادة من بعد.', 'Grand public, questions organisées et rediffusion.', 'A large audience, organised questions and a replay.')],
        ['🕌', L('الدروس الدينية', 'Cours religieux', 'Religious classes'), L('حلقات ودروس مع صوت الانتظار قبل البداية.', 'Cercles et cours, avec un son d’attente avant le début.', 'Circles and classes, with a waiting sound before the start.')],
        ['📣', L('الأحداث المباشرة', 'Événements en direct', 'Live events'), L('إعلانات وتقديمات لجمهورك فكل مكان.', 'Annonces et présentations pour votre public, partout.', 'Announcements and presentations for your audience, anywhere.')],
      ]));

    const join = el('section', { id: 'join', class: 'site-sec site-join' }, el('h2', { class: 'home-title' }, L('كيفاش نحضر لايف؟', 'Comment rejoindre un live ?', 'How do I join a live?')),
      el('ol', { class: 'site-steps' },
        el('li', {}, L('المنظم كيصيفط ليك رابط (واتساب، إيميل…).', 'L’organisateur vous envoie un lien (WhatsApp, e-mail…).', 'The organiser sends you a link (WhatsApp, e-mail…).')),
        el('li', {}, L('كليكي على الرابط فالوقت ديال اللايف.', 'Cliquez sur le lien à l’heure du live.', 'Open the link at the time of the live.')),
        el('li', {}, L('كتدخل نيشان: الكود راه فالرابط.', 'Vous entrez directement : le code est déjà dans le lien.', 'You come straight in: the code is already in the link.'))));

    const note = el('p', { class: 'muted', hidden: true, role: 'status' });
    const install = section('install', L('التطبيق فكل جهاز', 'L’application sur tous vos appareils', 'The app on all your devices'),
      L('ثبت REGAM Live بحال أي تطبيق: أيقونة، نافذة ديالو، وإشعار ملي يبدا اللايف.', 'Installez REGAM Live comme une application : une icône, sa propre fenêtre et une notification quand un live commence.', 'Install REGAM Live like any app: an icon, its own window and a notification when a live starts.'),
      el('p', {}, el('button', { class: 'btn primary big', type: 'button', onclick: (e) => installNow(e.currentTarget, note) }, '⬇ ' + L('ثبت التطبيق فهاد الجهاز', 'Installer l’application sur cet appareil', 'Install the app on this device'))), note,
      cards([
        ['🪟', 'Windows', L('ف Chrome ولا Edge: كليكي على أيقونة التثبيت فشريط العنوان، ثم «تثبيت».', 'Dans Chrome ou Edge : cliquez sur l’icône d’installation dans la barre d’adresse, puis « Installer ».', 'In Chrome or Edge: click the install icon in the address bar, then “Install”.')],
        ['🍎', 'Mac', L('ف Chrome: أيقونة التثبيت فشريط العنوان. ف Safari: ملف ← «إضافة إلى Dock».', 'Dans Chrome : l’icône d’installation dans la barre d’adresse. Dans Safari : Fichier → « Ajouter au Dock ».', 'In Chrome: the install icon in the address bar. In Safari: File → “Add to Dock”.')],
        ['📱', 'iPhone / iPad', L('ف Safari: زر «مشاركة» ثم «على الشاشة الرئيسية».', 'Dans Safari : bouton « Partager », puis « Sur l’écran d’accueil ».', 'In Safari: the “Share” button, then “Add to Home Screen”.')],
        ['🤖', 'Android', L('ف Chrome: القائمة ⋮ ثم «تثبيت التطبيق».', 'Dans Chrome : menu ⋮, puis « Installer l’application ».', 'In Chrome: the ⋮ menu, then “Install app”.')],
      ]));

    // the real applications for computers, when the installer has built them for this site
    fetch('/api/apps').then((r) => r.json()).then((d) => {
      if (!d.apps || !d.apps.length) return;
      const NAME = { windows: 'Windows', 'mac-arm': L('Mac (معالج Apple M1 فما فوق)', 'Mac (puce Apple M1 et plus)', 'Mac (Apple chip, M1 and later)'), 'mac-intel': L('Mac (معالج Intel)', 'Mac (processeur Intel)', 'Mac (Intel processor)') };
      const box = el('div', { class: 'site-dl', id: 'downloads' },
        el('h3', {}, L('حمل التطبيق للحاسوب', 'Téléchargez l’application pour ordinateur', 'Download the app for your computer')),
        el('div', { class: 'site-dl-row' }, ...d.apps.map((a) => el('a', { class: 'btn primary big', href: a.url, download: '' }, '⬇ ' + NAME[a.kind], el('small', {}, ' ' + Math.round(a.size / 1e6) + ' Mo')))),
        el('p', { class: 'muted' }, L('Windows: فك الملف، حل الدوسي «REGAM Live» وكليكي جوج مرات على «REGAM Live.exe». إلا بان تنبيه أزرق، كليكي «معلومات إضافية» ثم «تشغيل على أي حال».',
          'Windows : décompressez le fichier, ouvrez le dossier « REGAM Live » et double-cliquez sur « REGAM Live.exe ». Si un avertissement bleu apparaît, cliquez sur « Informations complémentaires » puis « Exécuter quand même ».',
          'Windows: unzip the file, open the “REGAM Live” folder and double-click “REGAM Live.exe”. If a blue warning appears, click “More info” then “Run anyway”.')),
        el('p', { class: 'muted' }, L('Mac: فك الملف وجر «REGAM Live» للتطبيقات. فأول مرة: كليكي باليمين على التطبيق ثم «فتح»؛ ولا من إعدادات النظام ← الخصوصية والأمان ← «فتح على أي حال».',
          'Mac : décompressez le fichier et glissez « REGAM Live » dans Applications. La première fois : clic droit sur l’application puis « Ouvrir » ; ou Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».',
          'Mac: unzip the file and drag “REGAM Live” to Applications. The first time: right-click the app then “Open”; or System Settings → Privacy & Security → “Open Anyway”.')));
      install.querySelector('.site-lead').after(box);
    }).catch(() => {});
    main.insertBefore(features, before);
    main.insertBefore(solutions, before);
    main.insertBefore(join, before);
    before.before(el('span', { id: 'pricing', class: 'site-anchor' }));
    before.after(install);
    if (location.hash) setTimeout(() => { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }, 300);
  }

  // ------------------------------------------------------ foot of the page --
  const foot = document.querySelector('footer.foot');
  if (foot) {
    const col = (title, links) => el('div', { class: 'foot-col' }, el('h3', {}, title), ...links.map(([t, h]) => el('a', { href: h }, t)));
    foot.classList.add('site-foot');
    foot.replaceChildren(
      el('div', { class: 'foot-col foot-brand' }, el('a', { class: 'brand', href: '/' }, 'REGAM', el('b', {}, 'Live')),
        el('p', {}, L('فضاء الدروس، التعليم عن بعد، الاجتماعات والكوتشينغ على المباشر.', 'L’espace des cours, de l’enseignement à distance, des réunions et du coaching en direct.', 'The space for classes, distance learning, meetings and coaching, live.'))),
      col(L('المنتوج', 'Produit', 'Product'), [[L('المميزات', 'Fonctionnalités', 'Features'), at('#features')], [L('الحلول', 'Solutions', 'Solutions'), at('#solutions')], [L('الأثمنة', 'Tarifs', 'Pricing'), at('#pricing')], [L('حساب مهني', 'Compte professionnel', 'Professional account'), '/teach']]),
      col(L('التطبيق', 'Application', 'App'), [['Windows', at('#install')], ['Mac', at('#install')], ['iPhone / iPad', at('#install')], ['Android', at('#install')]]),
      col(L('الدعم', 'Support', 'Support'), [[L('مركز المساعدة', 'Centre d’aide', 'Help centre'), '/support'], [L('تواصل معنا', 'Nous contacter', 'Contact us'), '/support#contact'], [L('شكاية', 'Réclamation', 'Complaint'), '/support#contact'], [L('الشروط والخصوصية', 'Conditions et confidentialité', 'Terms and privacy'), '/legal']]),
      col(L('الأساتذة', 'Professeurs', 'Teachers'), [[L('الاستوديو', 'Le studio', 'The studio'), '/studio'], [L('كري حساب مهني', 'Créer un compte professionnel', 'Open a professional account'), '/teach'], [L('خلص ولا جدد', 'Payer ou renouveler', 'Pay or renew'), '/teach']]),
      el('p', { class: 'foot-copy' }, '© ' + new Date().getFullYear() + ' REGAM Live'));
  }
})();
