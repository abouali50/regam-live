# REGAM Academy

مكتبة رياضيات للثانية باكالوريا المغربية، بالدارجة والمصطلحات الفرنسية.

الموقع فيه مسار **Sciences Physiques / SVT** ومسار **Sciences Mathématiques A/B**. كاتختار المسار، من بعد المحور، ومن بعد الدرس. كل درس كيجمع الشرح والأمثلة والخلاصة و3 تمارين محلولة، مع أسئلة قصيرة باش تتأكد من الفهم.

## التثبيت على VPS

فـ Terminal ديال VPS، وأنت داخل بحساب root، دير كوبي كولي لهاد الأمر كامل:

```bash
REGAM_SRC="$(mktemp -d /tmp/regam-bac-source.XXXXXX)" && git clone --depth 1 --single-branch --branch academy-maths-v1 https://github.com/abouali50/regam-live.git "$REGAM_SRC" && bash "$REGAM_SRC/install.sh"
```

البرنامج غادي يطلب منك **الدومين الجديد ديال الموقع** و**الإيميل ديال شهادة HTTPS**. خاص DNS ديال الدومين يشير للـ VPS قبل التثبيت. `bos.hostingervps.com` هو العنوان اللي عطيتينا للدخول عند Hostinger، ماشي اسم الموقع التعليمي الجديد.

المثبّت كيدعم Ubuntu وDebian مع systemd، مع Nginx أو Caddy بالإعداد المعتاد. كيدعم حتى وضع Docker المباشر ديال REGAM Live إلا تطابقت إعداداتو مع التثبيت المعروف: كيزيد خادماً صغيراً مستقلاً للموقع، وكيضيف الدومين فـ Caddy بلا إعادة إنشاء خدمات LIVE. إعدادات Apache أو proxy آخر داخل Docker أو panel بإعداد خاص كتحتاج دمج مناسب. كيتوقف برسالة واضحة إلا ما لقاوش الشروط، وما كيعلن `DONE` حتى يتحقق من HTTPS ومن الصفحة المنشورة.

إلا حدّثتي REGAM Live من بعد، المثبّت ديالو يقدر يعاود يكتب Caddyfile ويحيد بلوك Academy. فهاد الحالة عاود أمر Academy بنفس الدومين. تفاصيل الشروط والرجوع للنسخة السابقة فدليل التثبيت.

هاد النسخة ففرع مستقل اسمه `academy-maths-v1` فـ `abouali50/regam-live`. التثبيت كيستعمل ملفات هاد الفرع. التفاصيل، التحديث والرجوع للنسخة السابقة فـ [دليل التثبيت](docs/INSTALL_FR.md).

## المحتوى

| المحور | بعض الدروس |
| --- | --- |
| Analyse | Limites، الحالات غير المحددة السبعة، Continuité، Dérivation، Fonctions réciproques، Étude de fonction، Suites، Logarithme، Exponentielle، Intégrales، Équations différentielles |
| تعميق Analyse للعلوم الرياضية | Rolle وTAF وIAF، Arctan، Suites adjacentes، Changement de variable وSommes de Riemann |
| Algèbre | Nombres complexes، تعميق الأعداد العقدية، Arithmétique، Structures algébriques، Espaces vectoriels |
| Géométrie | الهندسة بالأعداد العقدية، الهندسة فالفضاء والكرات لمسار PC/SVT |
| Probabilités | Dénombrement، Probabilités conditionnelles، Variables aléatoires، Loi binomiale |

مجموع المكتبة **25 درساً، 133 جزءاً للشرح، 75 تمريناً مصححاً و43 سؤالاً قصيراً**. منها 18 درساً فمسار PC/SVT و23 فمسار SM، حيث بعض الدروس مشتركة. هاد الأعداد تقسيم بيداغوجي ديال الموقع، ماشي عدد رسمي للوزارة.

### نوع الفيديوهات

- **7 فيديوهات بتعليق صوتي اصطناعي** كتشرح الحالات غير المحددة فالنهايات.
- **24 شرحاً بصرياً مكتوباً بلا تعليق صوتي**، كل واحد كيشرح مثال درس آخر خطوة بخطوة. نوع الفيديو مبيّن فالمشغّل والوصف.

الفيديوهات البصرية مفيدة للمراجعة مع التوقف على كل خطوة. ماشي تسجيلات بصوت أستاذة، وما كاينش فيها تقليد لشخص حقيقي. الخدمة الخارجية ما رجّعاتش التسجيلات الصوتية الجديدة أثناء تجهيز هاد النسخة. نصوص الشرح محفوظة فـ `content/` باش يمكن تسجيلها من بعد.

## استعمال الموقع

فتح `site/index.html` كيشغّل الموقع محلياً. أو شغّل خادم بسيط من جذر المشروع:

```bash
python3 -m http.server 8080 --directory site
```

من بعد افتح `http://localhost:8080`. فاستضافة عادية، ارفع محتويات `site/` للمجلد العمومي ديال الموقع. Node.js وقاعدة بيانات ومفاتيح API ما مطلوبينش فالسيرفر.

كاين البحث بالعربية والفرنسية، الدروس المفضلة، تتبع التقدم، الوضع الليلي، وطباعة الخلاصة. المفضلة والتقدم كيتحفظو فالمتصفح اللي كتستعمل، وما كيتزامنوش بين الأجهزة. الفيديوهات والخطوط ومحرك المعادلات محليين، وما كايناش مكتبات CDN أو أدوات تتبع.

## تعديل الدروس

المحتوى الأصلي فـ `content/core_lessons.json` و`analysis_extra.json` و`other_lessons.json` و`sm_lessons.json`. عدّل JSON ثم شغّل:

```bash
python3 scripts/build_content.py
```

`site/data/courses.js` ملف مولّد، ما تعدلوش مباشرة. `content/build_core.py` هو أصل بناء الدروس الأساسية. إلا عدلتي شي درس أساسي، حافظ على التعديل حتى فهاد المصدر قبل تشغيله من جديد.

ربط الفيديوهات كاين فـ `content/video_catalog.json` و`content/video_catalog_extra.json`. كل ملف مذكور خاصو يكون موجود تحت `site/`. وصف `silent: true` كيميّز الشروح بلا صوت.

## التحقق

```bash
bash install.sh --check
python3 -m unittest discover -s tests -p 'installer_test.py' -v
npm install --ignore-scripts
npm test
```

Node.js هنا غير لاختبارات التطوير. الاختبارات كتتحقق من مسارات الدروس، عرض المعادلات، التمارين، البحث والمفضلة، ومن ضوابط المثبّت باستعمال ملفات مؤقتة. ما كتعنيش أنه تجرّب تنصيب حقيقي على VPS ديالك. نتائج هاد النسخة فـ [VALIDATION.md](docs/VALIDATION.md).

## مراجع المقرر

الشرح والتمارين مكتوبين للموقع. فهرسة البرنامج مبنية على نسخ منشورة من التوجيهات التربوية، مع التمييز بين وثيقة الوزارة والموقع اللي كيستضيفها. هاد النسخة ما كتدّعيش أنها إصدار رسمي أو أنها تحققت من جميع تعديلات امتحان 2027. تفاصيل الوثائق وتواريخها فـ [CURRICULUM_SOURCES.md](docs/CURRICULUM_SOURCES.md) وصفحة المصادر داخل الموقع.

KaTeX موزع مع ترخيصه الأصلي داخل `site/assets/vendor/KaTeX-LICENSE`. تراخيص خطوط الشروح البصرية مرفقة مع أصولها عند توزيع مصدرها.
