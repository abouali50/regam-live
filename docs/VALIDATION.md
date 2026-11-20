# Validation de REGAM Academy

Contrôle du 20 novembre 2026. Ce document décrit les vérifications réellement
exécutées sur les fichiers du projet. Il ne constitue pas une validation d'une
installation sur le VPS.

## Contenu et séparation des parcours

Le catalogue rassemble **25 leçons originales**, **133 sections**, **75 exercices
corrigés** et **43 questions à choix multiple**. Le parcours PC / SVT contient
18 leçons et le parcours Sciences Mathématiques A / B en contient 23. Les leçons
communes sont partagées entre les parcours, leur somme n'est donc pas le nombre
de leçons distinctes.

Les deux leçons de géométrie dans l'espace et de sphères sont réservées au
parcours PC / SVT. Les sept compléments de Sciences Mathématiques sont réservés
à ce parcours. Les nombres complexes sont rangés dans l'algèbre, leur lecture
géométrique dans la géométrie.

Les calculs des 75 réponses et les choix des 43 quiz ont été relus. Les points
particuliers examinés comprennent les domaines des logarithmes et des fonctions
réciproques, les conditions de TVI / Rolle / TAF, le besoin de prouver la
convergence avant de passer à une équation de point fixe, les signes des
dérivées, les extrema de la fonction rationnelle étudiée, les conditions
d'indépendance et les probabilités sans remise. Cette relecture ne vaut pas
certification d'un programme d'examen futur. La provenance et la portée des
documents de programme figurent dans `CURRICULUM_SOURCES.md`.

## Application

Le test d'intégration `tests/site_test.cjs` est passé avec les vraies données et
le vrai moteur KaTeX local. Il utilise jsdom, sans navigateur ni requête réseau.

- **2 540 expressions mathématiques** acceptées par KaTeX avec erreur bloquante.
- **182 routes valides** rendues, dont les quatre onglets de chaque leçon dans
  chaque parcours où elle est présente.
- Recherche avec accents, échappement des entrées de recherche, favoris,
  progression locale, quiz correct et incorrect, thème et menu mobile vérifiés.
- Tous les chemins des fichiers vidéo, des affiches et des sous-titres référencés
  ont été contrôlés à chaque route vidéo.
- Aucun événement d'erreur jsdom ou console pendant le test.

L'inventaire vidéo final comporte **31 fichiers MP4** : **7 avec commentaire
sonore synthétique** pour les formes indéterminées et **24 exposés visuels
écrits sans son**, un pour chacune des autres leçons. Le test d'intégration a
été relancé sur ce catalogue final et a contrôlé tous ses chemins de médias.
Le test calcule le nombre de vidéos depuis les données et ne fixe pas ce nombre
en dur.

Les 24 nouveaux fichiers ont aussi été inspectés avec ffprobe. Ils contiennent
chacun un unique flux vidéo H.264 de 1 600 × 900 pixels et aucun flux audio.
Leur durée correspond à celle déclarée dans le catalogue, à moins de 0,2 seconde
près. Les autres sept MP4 sont les enregistrements déjà disponibles, avec leur
audio et leurs sous-titres locaux.

Le lecteur distingue explicitement les fichiers marqués `silent: true`. Leur
notice annonce un **exposé visuel écrit sans commentaire sonore**. Aucune prise
de parole n'est annoncée pour ces fichiers. Le nombre de vidéos affiché est
calculé à partir des fichiers effectivement attachés aux leçons.

Ces tests ne vérifient pas le rendu visuel d'un vrai navigateur, la lecture
audio, la prononciation de la voix, ni le décodage MP4 sur chaque appareil.

## Installateur

Les **26 tests de l'installateur** passent, ainsi que le contrôle de syntaxe
Bash et `bash install.sh --check`. Les tests utilisent des dossiers temporaires
et de faux appels de service. Aucun paquet, certificat, serveur ou pare-feu
n'a été modifié pendant ces contrôles.

Ils couvrent notamment la saisie guidée du domaine et de l'email, le refus d'une
URL de console Hostinger, les collisions de domaines, les liens symboliques
non autorisés, la conservation des autres sites Caddy, les configurations Nginx
générées, le refus de listeners inconnus et la restauration de la version
précédente lors d'un échec.

Sept tests supplémentaires portent sur l'intégration Docker du mode direct
REGAM Live. Ils vérifient l'admission de la seule disposition attendue, le refus
d'autres propriétaires des ports et alias, l'identité et l'isolation du serveur
statique, la détection sans socket `docker-proxy`, la conservation de l'inode
du Caddyfile et des autres hôtes, la restauration après échec et la suppression
du seul nouveau conteneur Academy. Les arguments de création sont vérifiés :
image existante, aucun port hôte et aucun label du projet Compose LIVE.

Le lien `current` est relatif au dossier des versions. Il fonctionne donc sur
l'hôte et dans le montage `/srv` du serveur statique. Les appels Docker des
tests sont simulés. Aucun daemon Docker, service LIVE ou VPS réel n'a été
modifié ou validé par ces tests.

L'environnement de validation est un conteneur Debian sans systemd actif. Le
contrôle local ne certifie donc ni la résolution DNS du domaine retenu, ni le
certificat HTTPS, ni une installation effective chez Hostinger. Ces points
sont vérifiés sur le VPS par l'installateur avant son message `DONE`.

## Reproduire les contrôles

Depuis la racine du projet, avec Python 3, Node.js et npm pour le développement :

```bash
python3 scripts/build_content.py
npm install --ignore-scripts
npm test
bash -n install.sh
python3 -m unittest discover -s tests -p 'installer_test.py' -v
bash install.sh --check
```

Node.js et les dépendances de test ne sont pas nécessaires au fonctionnement
du site publié. Seul le dossier `site/` est servi par le serveur web.
