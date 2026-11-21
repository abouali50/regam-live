# REGAM Academy 1.1

Une bibliothèque de mathématiques pour la deuxième année du baccalauréat marocain, disponible en **arabe standard, en français et en anglais**.

Le site propose deux parcours, **Sciences Physiques / SVT** et **Sciences Mathématiques A/B**. Chaque parcours donne accès aux domaines, aux cours, aux exemples, aux fiches de révision, aux exercices corrigés et aux quiz.

## Les trois langues

Le sélecteur **العربية الفصحى / Français / English** traduit les menus et l'ensemble du contenu pédagogique. L'arabe standard est la langue initiale. Le choix de langue est conservé dans le navigateur, avec le cours ouvert, les favoris et la progression. La présentation passe automatiquement de droite à gauche ou de gauche à droite.

Il est possible de partager un lien avec une langue précise, par exemple `?lang=fr#/videos` ou `?lang=en#/videos`. La recherche reconnaît les titres et les mots-clés des trois langues.

## Les cours

| Domaine | Exemples de contenu |
| --- | --- |
| Analyse | Limites, sept formes indéterminées, continuité, dérivation, fonctions réciproques, étude de fonction, suites, logarithme, exponentielle, intégrales, équations différentielles |
| Approfondissements en Sciences Mathématiques | Rolle, théorème et inégalité des accroissements finis, arctangente, suites adjacentes, changement de variable, sommes de Riemann |
| Algèbre | Nombres complexes, arithmétique, structures algébriques, espaces vectoriels |
| Géométrie | Géométrie avec les nombres complexes, géométrie dans l'espace et sphères pour PC/SVT |
| Probabilités | Dénombrement, probabilités conditionnelles, variables aléatoires, loi binomiale |

Chaque langue contient **25 cours, 133 sections, 75 exercices corrigés et 43 questions de quiz**. Le parcours PC/SVT comprend 18 cours et le parcours SM en comprend 23, avec des cours partagés. Ces nombres correspondent à l'organisation pédagogique du site, pas au découpage officiel du ministère.

## Des vidéos directement accessibles

La rubrique **Vidéos**, le bouton de la page d'accueil et les lecteurs intégrés aux cours donnent accès à **31 explications vidéo dans chaque langue**. Chaque lecteur propose également l'ouverture directe du fichier et le téléchargement MP4.

- **24 explications visuelles sans voix** disposent chacune d'une version en arabe standard, en français et en anglais. Le texte à l'écran, les sous-titres et la transcription correspondent à la langue sélectionnée. Cela représente 72 nouveaux MP4 localisés.
- **7 vidéos sur les formes indéterminées** conservent leur narration synthétique d'origine en darija. Elles proposent désormais des sous-titres en arabe standard, en français et en anglais. Le lecteur indique explicitement la langue de la voix.

Les 24 explications écrites ne contiennent pas de piste audio. Cette version ne comprend pas de nouveau doublage vocal en arabe standard, en français ou en anglais. Les anciennes vidéos restent dans les fichiers pour préserver leurs liens existants.

## Installation ou mise à jour sur le VPS Hostinger

Dans le terminal du VPS, avec le compte `root`, copier-coller le bloc suivant. L'installateur demande ensuite le domaine du site et l'adresse email du certificat HTTPS.

```bash
REGAM_SRC="$(mktemp -d /tmp/regam-bac-source.XXXXXX)" && git clone --depth 1 --single-branch --branch academy-maths-v1 https://github.com/abouali50/regam-live.git "$REGAM_SRC" && bash "$REGAM_SRC/install.sh"
```

Pour mettre à jour une installation existante, utiliser **le même domaine Academy**. La commande récupère la nouvelle version, conserve une sauvegarde et vérifie le site en HTTPS avant d'afficher `DONE`. La branche de publication reste `academy-maths-v1`, y compris pour la version 1.1.

Le DNS du domaine doit pointer directement vers le VPS. Le script prend en charge Ubuntu et Debian avec systemd et les configurations Caddy ou Nginx décrites dans le [guide d'installation](docs/INSTALL_FR.md). Il reconnaît aussi la disposition Docker précise de REGAM Live documentée dans ce guide. Il s'arrête si l'environnement ne correspond pas aux conditions prévues.

Le terminal `bos.hostingervps.com` sert à exécuter cette commande. L'adresse publique de l'Academy est le domaine transmis à l'installateur.

## Utilisation locale ou hébergement statique

Le site contient ses propres vidéos, sous-titres, polices et moteur de formules. Son fonctionnement n'exige ni base de données, ni Node.js, ni clé API sur le serveur.

```bash
python3 -m http.server 8080 --directory site
```

Ouvrir ensuite `http://localhost:8080`. On peut également ouvrir `site/index.html` directement, ou copier le contenu de `site/` dans le répertoire public d'un hébergement statique. Les favoris et la progression sont propres au navigateur utilisé et ne sont pas synchronisés entre appareils.

## Modifier le contenu

Les sources actuelles sont `content/locales/ar.json`, `content/locales/fr.json` et `content/locales/en.json`. Conserver les identifiants des cours, l'ordre des réponses et les index des solutions lorsqu'on modifie une traduction. Puis régénérer le contenu publié avec cette commande.

```bash
python3 scripts/build_content.py
```

`site/data/courses.js` est un fichier généré. Il contient les trois langues pour permettre aussi un usage local sans requête réseau supplémentaire. Les anciens fichiers `content/core_lessons.json`, `analysis_extra.json`, `other_lessons.json` et `sm_lessons.json` restent les sources historiques de la version 1.0. Le générateur 1.1 utilise les fichiers de `content/locales/`.

Les scripts des 24 vidéos visuelles se trouvent dans `content/locales/video_scripts_ar.json`, `video_scripts_fr.json` et `video_scripts_en.json`. Pour régénérer une langue, avec Python, Pillow, NumPy, Matplotlib, FFmpeg et les polices locales disponibles, exécuter par exemple les deux commandes suivantes.

```bash
python3 scripts/render_localized_videos.py --lang fr --workers 4
python3 scripts/build_content.py
```

Les MP4, affiches et sous-titres sont écrits dans `site/media/fr/`. Le catalogue correspondant est généré dans `content/locales/video_catalog_fr.json`. Les sous-titres des sept vidéos avec narration d'origine se trouvent dans `site/media/captions/ar/`, `fr/` et `en/`.

Les libellés de navigation sont définis dans `site/assets/i18n.js`. Les sous-titres, la transcription et la mention de l'absence de voix doivent rester cohérents avec chaque fichier vidéo.

## Vérification

```bash
bash install.sh --check
npm ci --ignore-scripts
npm test
```

Les tests vérifient les routes, les formules, les exercices, la recherche, la sélection des langues, les vidéos et les données locales. Ils utilisent jsdom et ne remplacent pas une vérification visuelle dans un navigateur. Les résultats précis de cette version, y compris les limites de vérification, figurent dans [VALIDATION_V1_1.md](docs/VALIDATION_V1_1.md).

Pour régénérer l'archive et les empreintes des fichiers, exécuter `python3 scripts/package_release.py`. Le programme exclut les caches, les dépendances de développement et les fichiers intermédiaires de fabrication des vidéos.

## Références pédagogiques

Les explications et les exercices ont été rédigés pour ce site. La sélection des chapitres s'appuie sur les documents recensés dans [CURRICULUM_SOURCES.md](docs/CURRICULUM_SOURCES.md), en distinguant les documents ministériels des sites qui les hébergent. Cette bibliothèque ne constitue pas une édition officielle du programme et ne prétend pas vérifier tous les changements éventuels de l'examen 2027.

KaTeX est distribué avec son fichier de licence dans `site/assets/vendor/KaTeX-LICENSE`. Les licences des polices utilisées pour produire les vidéos sont également conservées dans les sources.
