# Validation de REGAM Academy 1.3.0-rc1

Date : 23 novembre 2026.

Cette version est une livraison de revue du parcours Étude des fonctions. Elle ne constitue pas la livraison des trente nouveaux MP4 narrés et n'a pas été installée sur Hostinger.

## Contenu disponible

- Huit cours ordonnés, avec progression par filière et liens vers les cours, exercices et vidéos réellement disponibles.
- Trois études écrites complètes, chacune avec seize étapes, dans les trois langues. Les neuf cartes utilisent des graphiques calculés, et leurs images indiquent explicitement qu'il s'agit d'études écrites.
- Trois exercices corrigés et trois quiz supplémentaires par langue, intégrés au cours de synthèse.
- Total par langue : 25 cours, 133 sections, 78 exercices, 46 quiz et 31 vidéos existantes.
- Les vidéos existantes comprennent une narration dans la langue sélectionnée, sept narrations en darija et vingt-trois explications visuelles sans narration.

Les nouvelles études portent sur les fonctions suivantes :

1. `f(x) = x + 1 + 4/(x - 1)`.
2. `g(x) = ln(x)/x`.
3. `h(x) = (x + 1) exp(-x)`.

Les domaines, dérivées, limites, tangentes, points remarquables et résultats des exercices ont été contrôlés symboliquement. Les courbes sont calculées à partir de ces fonctions. Les deux branches de la fonction rationnelle sont séparées à la valeur interdite.

## Contrôles exécutés

`npm test` réussit sur le contenu final de cette version de revue.

| Contrôle | Résultat |
| --- | --- |
| Site et routes existantes | 182 routes valides, 2 602 formules contrôlées |
| Intégration multilingue | 3 langues, 412 visites de routes, 282 soumissions de quiz |
| Mathématiques du catalogue | 7 806 formules et 2 589 formules de transcriptions contrôlées |
| Médias existants | 251 fichiers, 864 sous-titres et 10 fichiers narrés contrôlés |
| Filtres audio | 21 contrôles réussis |
| Parcours des fonctions | 16 scénarios de progression et 3 scénarios de chapitres réussis |
| Études écrites | 9 cartes et leurs 144 équations vérifiées |
| Installateur et vérification de publication | 29 tests Python réussis, dont 26 pour l'installateur et 3 pour le vérificateur |
| Sources et syntaxe | `bash install.sh --check`, compilation des nouveaux scripts Python et `git diff --check` réussis |

Les interactions du site sont testées avec jsdom. Cela ne constitue pas une revue visuelle de mise en page dans un navigateur ni une écoute des voix. Les graphiques et tableaux ont fait l'objet d'une revue visuelle sur un échantillon de dix-neuf images pédagogiques, puis les images récapitulatives ont été corrigées et régénérées.

## Chaîne de préparation audio

Les deux points d'entrée publics désactivent toute nouvelle requête de synthèse en ligne par défaut. Sans `allow_online=True` ou `--allow-online-voice`, un texte non présent dans le cache entraîne un refus avant l'appel au service. Un contrôle local avec requêtes simulées a vérifié zéro appel au service dans ces conditions.

La génération en ligne des leçons est suspendue à la suite d'un refus de la revue automatique d'autorisation. L'accord explicite du propriétaire est attendu pour envoyer uniquement les textes pédagogiques au service vocal Microsoft. Aucun des trente nouveaux MP4 n'est présenté comme terminé dans cette version.

Un essai strictement hors ligne de l'assemblage a utilisé deux images de 1 600 × 900 pixels et des sons de test sinusoïdaux créés localement. Il a vérifié :

- Un MP4 contenant une piste H.264 et une piste AAC, de 7,166667 secondes.
- Un signal audio non silencieux, de niveau moyen −19,6 dB.
- Des sous-titres alignés sur les durées mesurées des deux scènes.
- La réutilisation du cache sans relancer FFmpeg ni ffprobe.
- La reconstruction après suppression du fichier VTT ou corruption du rapport JSON.
- Les empreintes des MP4, posters et sous-titres, et le remplacement atomique des métadonnées.

Cet essai valide la chaîne technique. Il ne valide pas la prononciation ou le naturel des futures narrations. Les médias de test étaient temporaires et ne font pas partie du site.

## Verrou de livraison

`python3 scripts/build_content.py --draft` produit la version de revue. La commande sans `--draft` échoue tant que les études narrées manquent. Ce refus a été vérifié.

La livraison finale attend les trente nouveaux MP4 et leurs sous-titres. Elle doit compter onze vidéos parlées dans la langue sélectionnée, sept clips en darija et seize explications encore sans voix par langue. La vérification du site publié et l'installation par copier-coller dans Hostinger restent à effectuer au moment de la livraison finale.
