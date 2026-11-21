# Vérification de REGAM Academy 1.1

Vérifications effectuées le 21 novembre 2026, avant publication de la correction multilingue sur la branche `academy-maths-v1`.

## Périmètre

Cette version remplace le contenu pédagogique en darija par trois ensembles complets en arabe standard, en français et en anglais. Elle ajoute un choix de langue, une bibliothèque vidéo visible, un lecteur dans les cours, des sous-titres et des transcriptions localisées. L'installateur du VPS n'a pas été modifié.

Chaque langue contient 25 cours, 133 sections, 75 exercices corrigés, 43 questions de quiz et 31 entrées vidéo. Les parcours contiennent respectivement 18 cours PC/SVT et 23 cours SM. Les identifiants, la structure, l'ordre des réponses et les 2 540 fragments mathématiques des sources de cours ont été conservés dans chaque traduction.

## Tests de l'application

| Vérification | Résultat |
| --- | --- |
| Ancienne suite `tests/site_test.cjs` | Réussie, 182 routes et 2 540 formules |
| Langues du nouveau test `tests/multilingual_test.cjs` | 3 |
| Vérifications de routes multilingues | 387 |
| Soumissions de réponses correctes ou incorrectes aux quiz | 264 |
| Vérifications des formules des cours | 7 620 |
| Vérifications exactes des formules des transcriptions rendues | 1 464 |
| Fichiers média locaux distincts référencés par les lecteurs | 251 |
| Repères de sous-titres vérifiés | 864 |

Les tests couvrent la navigation effective, les onglets des cours, la sélection et la persistance de la langue, le maintien de la route lors du changement, les favoris et la progression par parcours, la recherche dans les trois langues, les 31 lecteurs de la bibliothèque, les lecteurs intégrés aux cours, les sous-titres, les transcriptions et les liens d'ouverture ou de téléchargement. Ils vérifient aussi la récupération après une erreur de média, le stockage local indisponible ou invalide et le fonctionnement du tiroir de navigation mobile.

La revue a identifié puis corrigé un message temporaire qui conservait la langue précédente, le retour de focus après fermeture du menu mobile et l'inertie du contenu derrière ce menu. Ces comportements sont couverts par la suite multilingue.

## Fichiers vidéo

Les 31 URL de la version déjà déployée sur `academy.regamebook.com` ont répondu HTTP 200 avec le type `video/mp4` et une taille correspondant aux fichiers sources lors de leur vérification. Cela confirme leur présence, sans constituer une écoute ou une lecture humaine intégrale.

La correction ajoute 72 MP4, soit 24 explications visuelles dans chacune des trois langues. Chaque fichier généré a été contrôlé avec ffprobe : H.264, 1 600 × 900, une piste vidéo et aucune piste audio. Les fichiers sont préparés pour une lecture progressive avec `faststart`. Les affiches, sous-titres et transcriptions accompagnent ces vidéos. Des images représentatives de limites en français et en arabe et de probabilités en anglais ont été examinées visuellement.

Les sept clips initiaux sur les formes indéterminées conservent leur voix synthétique en darija. Leurs sous-titres sont disponibles dans les trois langues. La version 1.1 ne contient pas de nouveau doublage en arabe standard, en français ou en anglais. Le site signale explicitement les vidéos sans voix et la langue de la narration d'origine.

## Limites de la vérification

Les tests de navigation s'exécutent avec jsdom et les vrais fichiers du site, dont KaTeX. Le lancement d'un navigateur graphique était bloqué dans l'environnement de vérification. Aucune validation de rendu au pixel près, lecture complète de chaque vidéo ou écoute complète des voix n'est revendiquée.

La publication GitHub ne met pas automatiquement à jour le VPS de l'utilisateur. La version en ligne reste celle qui y est installée jusqu'à l'exécution de la commande de mise à jour. L'installateur effectue ensuite ses propres contrôles DNS, HTTPS et de la version servie avant de déclarer `DONE`.

Les résultats de l'installateur de la version précédente sont conservés dans [VALIDATION.md](VALIDATION.md). Cette correction de contenu n'a pas été utilisée pour modifier les autres sites, leur DNS ou leurs services.
