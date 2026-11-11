// REGAM Live - interface languages: Arabic (source text), French, English.
// T('arabic text') returns the text in the chosen language; the page markup is
// translated in place, so the HTML stays written in one language only.
'use strict';

const LANGS = { ar: 'العربية', fr: 'Français', en: 'English' };

// 'arabic source': [french, english]
const DICT = {
  // ---- shared
  'مباشر': ['En direct', 'Live'],
  'غير مباشر': ['Hors ligne', 'Offline'],
  'المتابعين دابا': ['Spectateurs en ce moment', 'Watching now'],
  'التعليقات': ['Commentaires', 'Comments'],
  'اكتب تعليق…': ['Écrire un commentaire…', 'Write a comment…'],
  'تعليق': ['Commentaire', 'Comment'],
  'إرسال': ['Envoyer', 'Send'],
  'رسائل جديدة ↓': ['Nouveaux messages ↓', 'New messages ↓'],
  'حذف': ['Supprimer', 'Delete'],
  'حظر': ['Bloquer', 'Ban'],
  'حذف التعليق': ['Supprimer le commentaire', 'Delete this comment'],
  'حظر صاحب التعليق': ["Bloquer l'auteur du commentaire", 'Ban the author of this comment'],
  'تحظر "{name}"؟ ما غاديش يبقى يقدر يكتب.': ['Bloquer « {name} » ? Il ne pourra plus écrire.', 'Ban "{name}"? They will no longer be able to comment.'],
  'تم حظرك من التعليق فهاد اللايف.': ['Vous avez été bloqué : vous ne pouvez plus commenter ce live.', 'You have been banned from commenting on this live.'],
  'الاتصال مقطوع، كنعاود نتصل…': ['Connexion perdue, reconnexion en cours…', 'Connection lost, reconnecting…'],
  'تسنى {n} ثواني قبل التعليق الجاي.': ['Attendez {n} secondes avant le prochain commentaire.', 'Wait {n} seconds before your next comment.'],
  'اللغة': ['Langue', 'Language'],

  // ---- viewer page
  'اللايف مازال ما بداش. خلي الصفحة مفتوحة، غادي يبدا بوحدو.': ["Le live n'a pas encore commencé. Gardez la page ouverte, il démarrera tout seul.", 'The live has not started yet. Keep this page open, it will start by itself.'],
  'شغّل الصوت': ['Activer le son', 'Turn sound on'],
  'نتا على المنصة': ['Vous êtes sur scène', 'You are on stage'],
  'سد الميكرو': ['Couper le micro', 'Mute microphone'],
  'حل الميكرو': ['Activer le micro', 'Unmute microphone'],
  'نزل من المنصة': ['Quitter la scène', 'Leave the stage'],
  'شارك': ['Partager', 'Share'],
  'طلب الطلوع': ['Demander à monter', 'Ask to join'],
  'إلغاء الطلب': ['Annuler la demande', 'Cancel request'],
  'التفاعلات': ['Réactions', 'Reactions'],
  'مجموع التفاعلات': ['Total des réactions', 'Total reactions'],
  'إعجاب': ["J'aime", 'Like'],
  'تعاطف': ['Soutien', 'Care'],
  'قلب': ['Cœur', 'Love'],
  'ضحك': ['Rire', 'Haha'],
  'مفاجأة': ['Oups', 'Oops'],
  'خجل': ['Gêné', 'Blush'],
  'تفكير': ['Je réfléchis', 'Thinking'],
  'شنو سميتك؟': ['Quel est votre nom ?', 'What is your name?'],
  'هاد السمية هي اللي غادي تبان مع التعليقات ديالك.': ["C'est le nom qui s'affichera avec vos commentaires.", 'This is the name shown with your comments.'],
  'السمية': ['Nom', 'Name'],
  'دخل': ['Entrer', 'Enter'],
  'من بعد': ['Plus tard', 'Later'],
  'صاحب اللايف قبل الطلب ديالك': ["L'animateur a accepté votre demande", 'The host accepted your request'],
  'غادي تبان بالكاميرا والصوت لكاع المتابعين. استعمل السماعات باش ما يكونش الصدى.': ["Tous les spectateurs vous verront et vous entendront. Utilisez des écouteurs pour éviter l'écho.", 'Every viewer will see and hear you. Use headphones to avoid echo.'],
  'طلع دابا': ['Monter maintenant', 'Join now'],
  'لا، شكرا': ['Non, merci', 'No, thanks'],
  '{name} على المنصة مع {host}': ['{name} est sur scène avec {host}', '{name} is on stage with {host}'],
  'المتصفح ديالك ما كيدعمش هاد البث. جرب Chrome ولا Safari.': ['Votre navigateur ne peut pas lire ce live. Essayez Chrome ou Safari.', 'Your browser cannot play this live. Try Chrome or Safari.'],
  'تنسخ الرابط. لصقو فين بغيتي.': ['Lien copié. Collez-le où vous voulez.', 'Link copied. Paste it anywhere.'],
  'تقطع الاتصال ديالك بالمنصة.': ['Votre connexion à la scène a été coupée.', 'Your connection to the stage was lost.'],
  'وصل الطلب ديالك. تسنى صاحب اللايف يقبلو.': ["Demande envoyée. Attendez que l'animateur l'accepte.", 'Request sent. Wait for the host to accept it.'],
  'خاصك تسمح للمتصفح باستعمال الكاميرا والميكرو، ومن بعد عاود.': ['Autorisez le navigateur à utiliser la caméra et le micro, puis réessayez.', 'Allow the browser to use your camera and microphone, then try again.'],
  'ما قدرناش نطلعوك للمنصة. تأكد من الكاميرا والأنترنيت وعاود.': ['Impossible de vous faire monter sur scène. Vérifiez la caméra et la connexion, puis réessayez.', 'Could not bring you on stage. Check your camera and connection, then try again.'],
  'سالا اللايف.': ['Le live est terminé.', 'The live has ended.'],
  'صاحب اللايف نزلك من المنصة.': ["L'animateur vous a retiré de la scène.", 'The host removed you from the stage.'],

  // ---- studio
  'الاستوديو · REGAM Live': ['Studio · REGAM Live', 'Studio · REGAM Live'],
  'الاستوديو': ['Studio', 'Studio'],
  'الإعجابات': ['Réactions', 'Reactions'],
  'دخول الاستوديو': ['Connexion au studio', 'Studio sign-in'],
  'كلمة السر': ['Mot de passe', 'Password'],
  'كلمة السر غالطة.': ['Mot de passe incorrect.', 'Wrong password.'],
  'محاولات بزاف. تسنى ربع ساعة وعاود.': ["Trop d'essais. Attendez un quart d'heure et réessayez.", 'Too many attempts. Wait fifteen minutes and try again.'],
  'على الهواء': ["À l'antenne", 'On air'],
  'جاهز. اختار المصدر وبدا اللايف.': ['Prêt. Choisissez la source et démarrez le live.', 'Ready. Choose your source and start the live.'],
  'ابدأ اللايف': ['Démarrer le live', 'Start live'],
  'وقف اللايف': ['Arrêter le live', 'Stop live'],
  'الكاميرا': ['Caméra', 'Camera'],
  'شارك الشاشة': ["Partager l'écran", 'Share screen'],
  'وقف مشاركة الشاشة': ['Arrêter le partage', 'Stop sharing'],
  'السبورة': ['Tableau blanc', 'Whiteboard'],
  'الميكرو': ['Micro', 'Microphone'],
  'المنصة': ['Scène', 'Stage'],
  'نزلو من المنصة': ['Retirer de la scène', 'Remove from stage'],
  'ما كاين حتى طلب دابا.': ['Aucune demande pour le moment.', 'No requests right now.'],
  'قبول': ['Accepter', 'Accept'],
  '{name} على المنصة': ['{name} est sur scène', '{name} is on stage'],
  'كنتسناو {name} يدخل…': ['En attente de {name}…', 'Waiting for {name} to join…'],
  'بدا اللايف أولا، عاد قبل الطلبات.': ["Démarrez d'abord le live, puis acceptez les demandes.", 'Start the live first, then accept requests.'],
  'التسجيلات': ['Enregistrements', 'Recordings'],
  'ما كاين حتى تسجيل. كل لايف كيتسجل بوحدو.': ['Aucun enregistrement. Chaque live est enregistré automatiquement.', 'No recordings yet. Every live is recorded automatically.'],
  'كيتسجل دابا…': ['Enregistrement en cours…', 'Recording now…'],
  'تحميل': ['Télécharger', 'Download'],
  'تحذف هاد التسجيل نهائيا؟': ['Supprimer définitivement cet enregistrement ?', 'Delete this recording permanently?'],
  'الإعدادات': ['Réglages', 'Settings'],
  'عنوان اللايف': ['Titre du live', 'Live title'],
  'مثلا: كيفاش تكري MetaMask': ['Exemple : créer un portefeuille MetaMask', 'Example: how to create a MetaMask wallet'],
  'حفظ': ['Enregistrer', 'Save'],
  'رسالة مثبتة': ['Message épinglé', 'Pinned message'],
  'كتبان فوق التعليقات': ["S'affiche au-dessus des commentaires", 'Shown above the comments'],
  'ثبت': ['Épingler', 'Pin'],
  'الوقت بين تعليقين': ['Délai entre deux commentaires', 'Delay between comments'],
  'بلا حد': ['Aucun', 'None'],
  '3 ثواني': ['3 secondes', '3 seconds'],
  '10 ثواني': ['10 secondes', '10 seconds'],
  '30 ثانية': ['30 secondes', '30 seconds'],
  'دقيقة': ['1 minute', '1 minute'],
  'الكتابة على السبورة': ['Écrire sur le tableau', 'Type on the whiteboard'],
  'الأداة': ['Outil', 'Tool'],
  'قلم': ['Stylo', 'Pen'],
  'كتابة': ['Texte', 'Text'],
  'تظليل': ['Surligneur', 'Highlighter'],
  'ممحاة': ['Gomme', 'Eraser'],
  'اللون': ['Couleur', 'Colour'],
  'أسود': ['Noir', 'Black'],
  'أحمر': ['Rouge', 'Red'],
  'أزرق': ['Bleu', 'Blue'],
  'أخضر': ['Vert', 'Green'],
  'الحجم': ['Taille', 'Size'],
  'صغير': ['Petit', 'Small'],
  'متوسط': ['Moyen', 'Medium'],
  'كبير': ['Grand', 'Large'],
  'تراجع': ['Annuler', 'Undo'],
  'مسح الكل': ['Tout effacer', 'Clear all'],
  'تمسح السبورة كاملة؟': ['Effacer tout le tableau ?', 'Clear the whole board?'],
  'الاستوديو كيخدم على Google Chrome ولا Edge فالحاسوب. حل هاد الصفحة فواحد منهم.': ["Le studio fonctionne avec Google Chrome ou Edge sur ordinateur. Ouvrez cette page dans l'un des deux.", 'The studio works in Google Chrome or Edge on a computer. Open this page in one of them.'],
  'ما قدرناش نحلو الكاميرا. تأكد من الإذن فالمتصفح.': ["Impossible d'ouvrir la caméra. Vérifiez l'autorisation dans le navigateur.", 'Could not open the camera. Check the permission in your browser.'],
  'ما قدرناش نحلو الميكرو. تأكد من الإذن فالمتصفح.': ["Impossible d'ouvrir le micro. Vérifiez l'autorisation dans le navigateur.", 'Could not open the microphone. Check the permission in your browser.'],
  'كنوجدو البث…': ['Préparation de la diffusion…', 'Preparing the broadcast…'],
  'كنتصلو…': ['Connexion…', 'Connecting…'],
  'نتا على الهواء. المتابعين كيشوفوك بتأخير ديال بضع ثواني.': ["Vous êtes à l'antenne. Les spectateurs vous voient avec quelques secondes de décalage.", 'You are on air. Viewers see you a few seconds late.'],
  'تقطع الاتصال بالسيرفر. تأكد من الأنترنيت وعاود بدا اللايف.': ['Connexion au serveur perdue. Vérifiez Internet et redémarrez le live.', 'Connection to the server was lost. Check your internet and start the live again.'],
  'سالات الجلسة. عاود دخل.': ['Session expirée. Reconnectez-vous.', 'Session expired. Sign in again.'],
  'ما قدرناش نبداو اللايف. السيرفر ديال البث ما كيجاوبش.': ['Impossible de démarrer le live. Le serveur de diffusion ne répond pas.', 'Could not start the live. The media server is not responding.'],
  'وقف اللايف.': ['Live arrêté.', 'Live stopped.'],
  '{name} طلع معاك للمنصة. استعمل السماعات باش ما يكونش الصدى.': ["{name} est sur scène avec vous. Utilisez des écouteurs pour éviter l'écho.", '{name} joined you on stage. Use headphones to avoid echo.'],
  'ما قدرناش نربطو الضيف. نزلو وعاود قبل الطلب ديالو.': ["Impossible de connecter l'invité. Retirez-le et acceptez de nouveau sa demande.", 'Could not connect the guest. Remove them and accept their request again.'],
};

const store18 = {
  get() { try { return localStorage.getItem('regam.lang'); } catch { return null; } },
  set(v) { try { localStorage.setItem('regam.lang', v); } catch { /* private mode */ } },
};
const LANG = (() => {
  const saved = store18.get();
  if (LANGS[saved]) return saved;
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return LANGS[nav] ? nav : 'ar';
})();

function T(text, vars) {
  let out = text;
  if (LANG !== 'ar' && DICT[text]) out = DICT[text][LANG === 'fr' ? 0 : 1];
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out;
}

// Translate the markup already on the page (text, placeholders, labels, tooltips).
function translatePage(root = document) {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  if (LANG === 'ar') return;
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const key = n.nodeValue.trim();
    if (key && DICT[key]) n.nodeValue = n.nodeValue.replace(key, T(key));
  }
  for (const node of (root.body || root).querySelectorAll('[placeholder],[aria-label],[title]')) {
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const v = node.getAttribute(attr);
      if (v && DICT[v]) node.setAttribute(attr, T(v));
    }
  }
  if (DICT[document.title]) document.title = T(document.title);
}

// Language menu in the page header. Changing it reloads the page.
let langSelect = null;
function mountLangPicker(host) {
  langSelect = document.createElement('select');
  langSelect.className = 'lang';
  langSelect.setAttribute('aria-label', T('اللغة'));
  for (const [code, name] of Object.entries(LANGS)) {
    const o = document.createElement('option');
    o.value = code; o.textContent = name; o.selected = code === LANG;
    langSelect.append(o);
  }
  langSelect.onchange = () => { store18.set(langSelect.value); location.reload(); };
  host.prepend(langSelect);
}
// A reload would cut a broadcast or a guest on stage: lock the menu meanwhile.
function lockLang(on) { if (langSelect) langSelect.disabled = on; }

translatePage();
const langHost = document.querySelector('.top .meta');
if (langHost) mountLangPicker(langHost);
