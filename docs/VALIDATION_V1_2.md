# Vérification de REGAM Academy 1.2

Vérification du 21 novembre 2026. Cette correction ajoute une vraie piste audio au chapitre des limites dans les trois langues.

## Diagnostic du site publié

La version 1.1 déjà installée sur `academy.regamebook.com` a été vérifiée indépendamment. La page d'accueil, le programme de navigation, les traductions de l'interface et le catalogue des cours étaient identiques aux fichiers locaux, selon leurs empreintes SHA-256. La vidéo française des limites était également identique au MP4 livré. Son inspection avec ffprobe montrait une piste H.264 et aucune piste audio. L'absence de son venait donc de ce fichier, sans défaut de transfert identifié.

## Correction livrée

| Langue | Voix synthétique du catalogue vidIQ | Durée du nouveau MP4 |
| --- | --- | --- |
| Arabe standard | Ghizlane, voix féminine, arabe standard | 65,5 secondes |
| Français | Victoria, voix féminine française | 55,67 secondes |
| Anglais | Alice, voix féminine britannique | 60,17 secondes |

Chaque MP4 contient une piste vidéo H.264 de 1 600 × 900 et une piste audio AAC. Les cinq phrases ont été générées séparément au sein d'une demande par langue, puis associées aux cinq étapes de calcul. Les durées des audios ont été mesurées avec ffprobe. Une pause d'environ deux secondes suit chaque phrase. Le débit de parole et la hauteur de voix ne sont pas modifiés.

Le niveau sonore est harmonisé par une normalisation en deux passes, avec une cible de −18 LUFS et une crête vraie de −2 dB. Les fichiers d'origine restent conservés. La mesure du son final confirme un signal non silencieux. Les images et les sous-titres suivent les durées réellement mesurées.

Les nouveaux fichiers utilisent `limites-narrated.mp4`, `limites-narrated.jpg` et `limites-narrated.vtt` dans chaque répertoire de langue. Les anciens MP4 silencieux restent présents pour conserver leurs liens. Les catalogues publics pointent vers les nouveaux fichiers et déclarent leur vraie langue audio.

Les textes exacts soumis, les voix, les identifiants de génération et les enregistrements d'origine sont conservés dans `content/narration/limites/`. Les fichiers de validation de ce dossier indiquent les empreintes et les temps de chaque scène. Le script `scripts/render_narrated_video.py` peut reconstruire le MP4 depuis ces fichiers sans demander une nouvelle génération vocale.

## Interface et couverture réelle

La bibliothèque propose des filtres pour toutes les vidéos, la voix dans la langue du site, toutes les narrations et les explications silencieuses. Chaque langue affiche actuellement une vidéo parlée dans cette langue, sept vidéos originales parlées en darija et vingt-trois explications sans voix.

Cette version ne prétend pas avoir doublé les vingt-trois autres cours ni les sept clips initiaux dans les trois langues. Les libellés distinguent ces cas. Le lecteur des limites reste au format paysage, avec commandes audio natives et sous-titres dans sa langue. Aucun attribut ne force le mode muet.

## Tests réussis

`npm test` a réussi sur les fichiers de la version 1.2.

| Vérification | Résultat |
| --- | --- |
| Suite d'origine | 182 routes et 2 540 formules |
| Locales de la suite multilingue | 3 |
| Vérifications de routes multilingues | 412 |
| Réponses correctes ou incorrectes aux quiz | 264 |
| Vérifications de formules des cours | 7 620 |
| Vérifications exactes des formules des transcriptions | 2 589 |
| Fichiers média locaux référencés | 251 |
| Repères de sous-titres vérifiés | 864 |
| MP4 parlés distincts dont la piste audio est contrôlée avec ffprobe | 10 |
| Navigations réelles entre les filtres audio | 21 |

Les filtres conservent le parcours scolaire sélectionné. Un changement de langue conserve le filtre et ouvre la version parlée correspondante. Les tests contrôlent la présence réelle d'une piste audio dans les fichiers, en plus des libellés.

## Limites

Les tests de l'application utilisent jsdom. Aucun contrôle visuel complet dans un navigateur graphique n'est revendiqué. Une image représentative de la nouvelle vidéo française a été examinée.

L'environnement ne permet pas l'écoute indépendante des fichiers audio. La présence du son, son niveau, son format et son synchronisme par scène ont été contrôlés techniquement, mais la prononciation et le naturel des voix n'ont pas fait l'objet d'une écoute humaine intégrale ou d'une transcription de contrôle. Les textes exacts soumis au service sont disponibles pour cette revue.

La mise à jour doit être exécutée sur le VPS après publication GitHub. Le script d'installation est conservé et effectue ses propres contrôles HTTPS et de la version réellement servie avant de déclarer `DONE`.
