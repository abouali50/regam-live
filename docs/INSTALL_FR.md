# Installer REGAM Academy sur un VPS Hostinger

Le site est statique. Il contient ses pages, ses cours, son moteur de navigation,
ses formules et ses médias locaux. Il n'a pas besoin de Node.js, d'une base de
données ou d'une clé API sur le VPS.

Le script est prévu pour **Ubuntu ou Debian avec systemd**. Il crée un site
indépendant sur **un nouveau domaine ou sous-domaine**. Le terminal Hostinger
sert à exécuter la commande. Son URL n'est pas le domaine du site pédagogique.

## Avant le copier-coller

1. Choisir un sous-domaine libre que vous contrôlez, par exemple
   `maths.votre-domaine.ma`. Cet exemple est à remplacer par votre vrai nom.
2. Créer son enregistrement DNS **A** vers l'adresse IPv4 du VPS.
3. Si un enregistrement **AAAA** existe, il doit pointer vers l'IPv6 de ce même
   VPS. Supprimer un ancien AAAA incorrect ou le corriger.
4. Pour cette installation automatique, le DNS doit pointer directement vers
   le VPS. Un proxy CDN doit être temporairement en mode « DNS uniquement ».
5. Les ports TCP **80 et 443** doivent être autorisés par le pare-feu Hostinger
   et celui du VPS. Le script ne réinitialise aucun pare-feu.
6. Ouvrir le terminal du VPS avec le compte `root`, ou utiliser `sudo`.

Le script vérifie la correspondance entre le DNS et les adresses réellement
présentes sur le VPS. Le mode direct Docker de l'installateur **REGAM Live** est
pris en charge sous les conditions précises décrites plus bas. Un serveur
derrière NAT, un autre proxy en conteneur ou un panneau d'hébergement à
configuration personnalisée nécessite une intégration adaptée. Le script
s'arrête dans ces cas avant de modifier le serveur web.

## Installation depuis GitHub

Le projet pédagogique est publié dans la branche indépendante
`academy-maths-v1` du dépôt `abouali50/regam-live`. Cette commande sélectionne
cette branche. La branche `main` du projet LIVE n'est pas utilisée.

Dans le terminal du VPS connecté en **root**, copier-coller cette commande.
L'installateur demande ensuite votre nouveau domaine et l'email du certificat.

```bash
REGAM_SRC="$(mktemp -d /tmp/regam-bac-source.XXXXXX)" && git clone --depth 1 --single-branch --branch academy-maths-v1 https://github.com/abouali50/regam-live.git "$REGAM_SRC" && bash "$REGAM_SRC/install.sh"
```

Ce bloc crée un nouveau dossier temporaire. Il ne supprime pas un ancien dépôt
ni les fichiers du site LIVE. Relancer le même bloc installe une nouvelle
version des cours tout en conservant la précédente.

Le bloc ci-dessus s'exécute depuis le terminal VPS connecté en root. Avec un
autre compte autorisé, remplacer le dernier `bash` par `sudo bash`.

La commande nécessite `git`, habituellement présent sur les VPS. Si le
terminal affiche `git: command not found`, installer ce paquet avec
`apt-get update && apt-get install -y git`, puis relancer la commande.

Il est aussi possible de passer explicitement les deux paramètres depuis le
dossier du clone :

```bash
sudo bash install.sh maths.votre-domaine.ma votre@email.com
```

L'adresse email est utilisée pour le certificat HTTPS. Le domaine de LIVE ou
celui d'un autre site déjà configuré ne doit pas être réutilisé pour cette
nouvelle installation.

## Contrôle sans installation

Dans le dossier du dépôt :

```bash
bash install.sh --check
```

Ce contrôle valide les fichiers nécessaires et la syntaxe du script. Il ne
requiert pas root et ne modifie aucun service ni fichier système. Un résultat
`CHECK OK` signifie que les sources sont prêtes, pas que le site est publié.

Sur le VPS, pour contrôler aussi le DNS sans installer :

```bash
bash install.sh --check maths.votre-domaine.ma votre@email.com
```

## Ce que fait l'installation

- Elle détecte les services et les processus qui occupent les ports 80 et 443.
- Si Caddy est actif avec son Caddyfile habituel, elle conserve ce fichier,
  ajoute un import identifié et un fichier dédié au nouveau site.
- Si le Caddy Docker du mode direct REGAM Live est reconnu, elle ajoute un
  serveur statique isolé sur son réseau et un bloc identifié dans son Caddyfile.
  Les autres conteneurs LIVE ne sont ni arrêtés ni recréés.
- Si Nginx est actif avec sa configuration habituelle, elle ajoute uniquement
  `/etc/nginx/conf.d/regam-bac-maths.conf`. Certbot utilise le mode **webroot**,
  sans réécrire les vhosts des autres sites.
- Si aucun serveur web n'est installé ni actif, elle installe Nginx et Certbot
  depuis les paquets de la distribution.
- Elle refuse une collision avec un domaine déjà utilisé, un listener inconnu,
  un proxy Docker autre que la disposition REGAM Live reconnue, Apache ou une
  configuration non standard.
- Elle copie les fichiers dans une nouvelle version sous
  `/var/www/regam-bac-maths/releases/`, puis change le lien `current` de manière
  atomique.
- Elle conserve les anciennes configurations dans un dossier de sauvegarde
  privé et restaure la version précédente si l'installation échoue.
- Elle vérifie le certificat, le contenu réellement servi et la page d'accueil
  avant d'afficher `DONE`.

Le renouvellement TLS est automatique avec Caddy. Pour Nginx, Certbot conserve
son certificat, son webroot et un hook de rechargement dédié. Le timer Certbot
de la distribution est activé lorsqu'il est disponible. Aucun certificat
appartenant à un autre domaine n'est remplacé par ce script.

## Cas du VPS déjà équipé de REGAM Live avec Docker

Le mode direct du dépôt `abouali50/regam-live` utilise un service Compose Caddy
qui publie les ports TCP 80 et 443. L'installateur Academy accepte cette
disposition après avoir vérifié les labels du projet `regam-live` et du service
`caddy`, sa commande Caddy 2, un unique réseau bridge du projet et le montage
en lecture seule de `/opt/regam-live/deploy/Caddyfile` vers
`/etc/caddy/Caddyfile`. Il contrôle également les ports publiés par les autres
conteneurs, même si Docker utilise nftables sans processus `docker-proxy`
visible. Aucune variable de l'environnement des conteneurs n'est lue.

Le nouveau conteneur `regam-bac-maths` réutilise l'image Caddy déjà présente,
identifiée par son SHA, sans téléchargement d'image. Il sert les fichiers en
lecture seule sur le port **interne 8080**, sans publier de port sur le VPS.
Il fonctionne avec l'utilisateur 65534, sans capacités supplémentaires et avec
des répertoires temporaires privés. Il n'appartient pas au projet Compose LIVE.
Le Caddy existant dirige seulement le nouveau domaine vers ce serveur statique.

Le fichier Caddy lié au conteneur est sauvegardé puis écrit **en conservant son
inode**, car le remplacer par renommage casserait la correspondance du montage
de fichier. Son empreinte est comparée entre l'hôte et le conteneur avant et
après écriture. La configuration est analysée puis rechargée dans le Caddy
actif, sans `docker compose up`, `down` ou recréation du service LIVE. En cas
d'échec, le fichier et la version du site sont restaurés. Seul le conteneur
Academy créé pendant cet essai est supprimé, jamais un conteneur adopté ni un
service LIVE.

Une installation Academy existante est réutilisée seulement si son identité,
son image enregistrée, ses montages, son réseau et ses protections correspondent
à l'état sauvegardé. Un conteneur arrêté, un nom déjà utilisé par un autre
service ou un réseau modifié entraîne un arrêt avec diagnostic.

**Après une mise à jour de REGAM Live**, son propre installateur peut réécrire
le Caddyfile et retirer le bloc Academy. Relancer alors la commande Academy avec
le même domaine pour rétablir ce bloc. Si la disposition réseau ou les montages
de LIVE ont changé, l'installateur demande une vérification manuelle plutôt que
de modifier les services existants.

Cette intégration a été contrôlée par des tests locaux avec des appels Docker
simulés. Elle n'a pas été exécutée sur votre VPS. Les contrôles réseau et HTTPS
de l'installation réelle restent nécessaires avant le message `DONE`.

## Résultat attendu

Le message de réussite contient votre adresse réelle :

```text
DONE · REGAM Academy est accessible : https://votre-domaine/
```

Cette ligne n'est affichée qu'après vérification HTTPS. Si le script affiche une
erreur DNS, un conflit de serveur ou un échec de certificat, le site n'est pas
déclaré installé. Conserver le message exact pour diagnostiquer la cause.

## Mise à jour et retour arrière

Pour mettre à jour, relancer la commande GitHub et saisir le même domaine. Chaque
installation réussie conserve la version qui la précédait.

Pour réactiver la version précédente depuis un clone du dépôt :

```bash
sudo bash install.sh --rollback
```

Le retour arrière conserve également la version que vous venez de quitter,
ce qui permet de basculer de nouveau si nécessaire. Il ne supprime ni médias
ni sauvegardes. Aucune purge automatique des anciennes versions n'est faite.

## Utiliser le ZIP sans GitHub

Extraire le ZIP sur le VPS. Se placer dans son dossier, puis lancer :

```bash
sudo bash install.sh
```

Sur un hébergement web classique, transférer simplement **le contenu du
dossier `site/`** dans le répertoire public prévu pour ce site. `install.sh`
sert uniquement au VPS. Ne pas transférer les tests ou le dépôt complet dans
un répertoire public.

## Vérifier le script localement

```bash
bash -n install.sh
python3 -m unittest discover -s tests -p 'installer_test.py' -v
```

Ces tests utilisent des dossiers temporaires et de faux appels de service.
Ils ne lancent pas l'installation réelle et n'ont pas besoin de réseau.

## Références techniques

- [Terminal web et SSH des VPS Hostinger](https://www.hostinger.com/support/5723772-how-to-connect-to-your-vps-via-ssh-at-hostinger/)
- [Caddy, import de fichiers de configuration](https://caddyserver.com/docs/caddyfile/directives/import)
- [Caddy, validation et rechargement](https://caddyserver.com/docs/command-line)
- [Caddy avec systemd](https://caddyserver.com/docs/running)
- [Certbot, mode webroot et renouvellement](https://eff-certbot.readthedocs.io/en/stable/using.html)

La validation et le rechargement de Caddy ne sont pas équivalents : l'adaptation
vérifie la structure, puis le rechargement provisionne la nouvelle configuration
dans le processus actif. Si ce rechargement échoue, Caddy garde sa configuration
active précédente. Le script restaure aussi les fichiers qu'il avait préparés.
