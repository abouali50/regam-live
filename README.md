# REGAM Academy 1.3 RC1

Cette version de travail prépare le parcours **Étude des fonctions** en arabe classique, français et anglais. Elle est destinée à la revue. La branche stable `academy-maths-v1` conserve la version 1.2 tant que les nouvelles narrations ne sont pas terminées et vérifiées.

## Ce qui est terminé

- Un parcours de huit cours, dans l'ordre : limites, continuité, dérivation, fonctions réciproques, logarithme, exponentielle, étude de fonction et intégration.
- Une navigation PC/SVT ou SM, avec une progression propre à chaque parcours, enregistrée dans le navigateur.
- Trois études guidées, de seize étapes chacune, pour une fonction rationnelle, logarithmique et exponentielle.
- Les trois langues complètes, les équations exactes, les courbes calculées et les tableaux de variations.
- Trois nouveaux exercices corrigés et trois nouveaux quiz dans chaque langue.
- Des chapitres cliquables lorsque la vidéo dispose de repères temporels réellement mesurés.

Le parcours s'ouvre avec `?lang=fr#/parcours/etude-fonctions`, ou avec `lang=ar` et `lang=en`.

## État réel des vidéos

Aucun nouveau MP4 de cette version n'est annoncé comme terminé. La version de revue conserve les médias de la version 1.2 : dans chaque langue, une vidéo des limites parlée dans la langue choisie, sept clips parlés en darija et vingt-trois explications visuelles sans voix.

Le lot prévu comprend trente nouveaux MP4 : sept exemples de cours existants et trois études complètes, chacun en arabe classique, français et anglais. Le cours des limites conserve ses trois MP4 déjà narrés.

La génération des nouvelles voix est suspendue. Elle nécessiterait l'envoi des textes pédagogiques au service vocal en ligne de Microsoft, via le client open source `edge-tts`. La revue automatique d'autorisation a demandé un accord explicite sur ce transfert. Le moteur est donc désactivé par défaut. Ni clé API ni accès au VPS ne sont nécessaires pour préparer les fichiers. Les vidéos finales auront leur audio intégré et fonctionneront sans service vocal sur le serveur.

## Études préparées

| Étude | Fonction | Éléments traités |
| --- | --- | --- |
| Rationnelle | f(x) = x + 1 + 4/(x − 1) | Domaine, limites de chaque côté de 1, asymptotes, dérivée, signes, extrema, tangente et nombre de solutions |
| Logarithmique | g(x) = ln(x)/x | Domaine positif, croissance comparée, maximum, signe, tangente, existence et unicité, inflexion en approfondissement |
| Exponentielle | h(x) = (x + 1) exp(−x) | Domaine, limites, produit, dérivée, maximum, signe, deux tangentes, nombre de solutions et inflexion |

Les sources sont dans `content/function_study_lessons.json`. Les illustrations calculées sont dans `site/media/studies/`. Aucun dessin génératif n'est utilisé pour les informations mathématiques.

## Vérification et prévisualisation locale

Pour reconstruire la version de revue, exécuter `python3 scripts/build_content.py --draft`. La construction finale, sans `--draft`, refuse de réussir si les trente nouveaux médias et leur couverture audio ne sont pas prêts.

Le site de revue contient 25 cours, 78 exercices et 46 quiz par langue. Les 31 vidéos référencées par langue sont celles déjà livrées dans la version 1.2.

Les contrôles s'exécutent avec `npm test`, `bash install.sh --check` et `python3 -m unittest discover -s tests -p '*_test.py'`. Ils comprennent les routes, les langues, les exercices, les formules, la progression, les chapitres et les pistes audio des médias existants. Les tests DOM ne constituent pas une revue visuelle dans un navigateur ni une écoute humaine des voix.

Les résultats et les limites de ces contrôles sont consignés dans [le rapport de validation RC1](docs/VALIDATION_V1_3_RC1.md).

Une prévisualisation locale peut être lancée avec `python3 -m http.server 8080 --directory site`, puis ouverte à `http://localhost:8080/?lang=fr#/parcours/etude-fonctions`.

## Installation

Cette branche de travail ne constitue pas encore la livraison audio finale. Aucune action sur Hostinger n'a été effectuée. Une fois les voix autorisées, rendues et vérifiées, la livraison utilisera le même installateur Academy et deux blocs prêts à copier-coller par le propriétaire dans son terminal Hostinger.

L'installateur Academy conserve une version précédente et sa configuration. Le mode d'installation existant est documenté dans `docs/INSTALL_FR.md`. Le projet LIVE de la branche `main` reste indépendant.

## Notes techniques de construction

- `scripts/voice_backend.py` prépare un audio par scène et vérifie qu'il est décodable et non silencieux. Le cache intermédiaire est sous `video_build/`, exclu du dépôt.
- `scripts/narrated_media.py` synchronise les étapes sur les durées mesurées, normalise le niveau et produit un MP4 H.264/AAC.
- `scripts/function_study_frames.py` calcule les graphiques et compose les images pédagogiques.
- `scripts/render_study_module.py` orchestre le lot après autorisation de la voix en ligne.
- `scripts/verify_published.py` vérifie les fichiers HTTPS à partir d'un manifeste dont l'empreinte exacte a été préalablement contrôlée.

Les voix prévues sont Zariyah (`ar-SA-ZariyahNeural`), Denise (`fr-FR-DeniseNeural`) et Sonia (`en-GB-SoniaNeural`). Il s'agit de voix synthétiques du service, sans clonage. La disponibilité du service en ligne n'est pas garantie. Une régénération peut différer de fichiers antérieurs. Les MP4 finaux sont les fichiers de diffusion à conserver.

Références et licences existantes : `docs/CURRICULUM_SOURCES.md`, les licences KaTeX et les polices fournies dans le dépôt. Cette bibliothèque est une création pédagogique indépendante, sans revendication d'édition officielle du programme national.
