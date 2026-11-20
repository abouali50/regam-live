#!/usr/bin/env bash
# REGAM Academy, static site installer. No changes outside this site's release,
# one dedicated virtual host, dependency packages, and certificate renewal hook.
set -Eeuo pipefail
IFS=$'\n\t'
umask 022

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SITE_DIR="$SCRIPT_DIR/site"
DEPLOY_BASE=/var/www/regam-bac-maths
STATE_DIR=/var/lib/regam-bac-maths
CADDY_MAIN=/etc/caddy/Caddyfile
CADDY_SITE=/etc/caddy/regam-bac-maths.d/site.caddy
NGINX_SITE=/etc/nginx/conf.d/regam-bac-maths.conf
MANAGED_MARKER='# Managed by REGAM_BAC_MATHS_V1'
IMPORT_LINE='import /etc/caddy/regam-bac-maths.d/site.caddy'
MODE=install
SERVER=''
DOMAIN=''
EMAIL=''
WORK_DIR=''
BACKUP_DIR=''
RELEASE=''
PREVIOUS=''
EXPECTED_HEALTH=''
CURRENT_CHANGED=0
CONFIG_CHANGED=0
COMMITTED=0
CADDY_WAS_RUNNING=0
NGINX_WAS_RUNNING=0
DOCKER_GUARD="$SCRIPT_DIR/scripts/docker_guard.py"
DOCKER_CADDY_MAIN=/opt/regam-live/deploy/Caddyfile
DOCKER_CADDY_ID=''
DOCKER_IMAGE=''
DOCKER_NETWORK=''
DOCKER_NETWORK_ID=''
DOCKER_SIDE_NAME=regam-bac-maths
DOCKER_SIDE_ID=''
DOCKER_SIDE_IMAGE=''
DOCKER_SIDE_CREATED=0

say() { printf '%s\n' "$*"; }
fail() { printf 'ERREUR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
REGAM Academy · Mathématiques du baccalauréat marocain

  bash install.sh --check
  bash install.sh --check maths.votre-domaine.ma votre@email.com
  sudo bash install.sh
  sudo bash install.sh maths.votre-domaine.ma votre@email.com
  sudo bash install.sh --rollback

--check : lecture seule, aucun paquet, service, DNS ou fichier système modifié.
Sans domaine, ce contrôle valide les sources et affiche l'environnement détecté.
Avec domaine et email, il vérifie aussi la résolution DNS vers ce VPS.
--rollback : réactive la version précédente déjà installée sur ce VPS.
Sans argument : demande le domaine du nouveau site et l'email du certificat.

Le domaine doit être un nom de site que vous contrôlez, pointant directement
vers ce VPS. L'URL du terminal Hostinger ne convient pas. Le certificat HTTPS
est obtenu gratuitement avec Caddy ou Let's Encrypt/Certbot.
USAGE
}

validate_domain() {
  local value="$1" label
  [[ ${#value} -le 253 && "$value" == *.* && "$value" != *..* ]] || return 1
  [[ "$value" =~ ^[a-z0-9.-]+$ && "$value" != .* && "$value" != *. ]] || return 1
  [[ ! "$value" =~ ^[0-9.]+$ ]] || return 1
  case "$value" in
    localhost|*.localhost|*.local|*.test|example.com|*.example.com|example.org|*.example.org|example.net|*.example.net|hostinger.com|*.hostinger.com|hostingervps.com|*.hostingervps.com) return 1 ;;
  esac
  local old_ifs="$IFS"; IFS=.
  read -r -a domain_labels <<< "$value"
  IFS="$old_ifs"
  for label in "${domain_labels[@]}"; do
    [[ ${#label} -ge 1 && ${#label} -le 63 && "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
  done
  [[ "${domain_labels[-1]}" =~ ^[a-z][a-z0-9-]+$ ]] || return 1
}

validate_email() {
  local value="$1"
  [[ ${#value} -le 254 && "$value" =~ ^[A-Za-z0-9.!_+%-]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$ && "$value" != *..* ]]
}

prompt_install_details() {
  say 'REGAM Academy · Installation guidée'
  say 'Préparez un nouveau domaine ou sous-domaine dont le DNS pointe vers ce VPS.'
  say 'bos.hostingervps.com est une adresse de console, pas celle du site à créer.'
  while :; do
    printf 'Domaine du site, sans https:// : ' >&2
    IFS= read -r DOMAIN || fail "Saisie interrompue. Relancez ou utilisez : bash install.sh DOMAINE EMAIL"
    DOMAIN="${DOMAIN,,}"
    if validate_domain "$DOMAIN"; then break; fi
    say 'Domaine invalide. Saisissez votre nouveau nom de site, sans chemin, port ou URL Hostinger.' >&2
  done
  while :; do
    printf 'Votre email pour le certificat HTTPS : ' >&2
    IFS= read -r EMAIL || fail "Saisie interrompue. Aucun changement effectué."
    if validate_email "$EMAIL"; then break; fi
    say 'Adresse email invalide. Vérifiez la saisie.' >&2
  done
}

require_command() { command -v "$1" >/dev/null 2>&1 || fail "Commande nécessaire absente : $1"; }

validate_sources() {
  [[ -f "$SITE_DIR/index.html" && ! -L "$SITE_DIR/index.html" ]] || fail "site/index.html est absent du dépôt. Relancez depuis un clone complet."
  [[ -f "$SITE_DIR/assets/app.js" && -f "$SITE_DIR/assets/style.css" && -f "$SITE_DIR/data/courses.js" ]] || fail "Le dossier site est incomplet (application, style ou cours manquants)."
  if find "$SITE_DIR" -type l -print -quit | IFS= read -r _; then
    fail "Le dossier site contient un lien symbolique. L'installation de fichiers hors du site est refusée."
  fi
  grep -qi 'REGAM' "$SITE_DIR/index.html" || fail "Le fichier index.html n'est pas identifié comme REGAM Academy."
  bash -n "$SCRIPT_DIR/install.sh" || fail "Le script n'est pas syntaxiquement valide."
}

check_platform() {
  [[ -r /etc/os-release ]] || fail "Installation prévue pour Ubuntu ou Debian."
  # This root-owned operating system file is the standard platform identifier.
  . /etc/os-release
  case "${ID:-}" in ubuntu|debian) ;; *) fail "Système non pris en charge : ${ID:-inconnu}. Ubuntu ou Debian requis." ;; esac
  [[ -d /run/systemd/system ]] || fail "systemd n'est pas actif. Aucun service ne sera créé dans ce conteneur ou environnement."
  require_command systemctl
  require_command ss
  require_command python3
  require_command ip
  require_command flock
}

running() { systemctl is-active --quiet "$1" 2>/dev/null; }

docker_metadata() {
  # Deliberately selected fields: never inspect or print Config.Env.
  docker container inspect --format '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"owner":{{json (index .Config.Labels "online.regam.bac-maths")}},"path":{{json .Path}},"args":{{json .Args}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"network_mode":{{json .HostConfig.NetworkMode}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"user":{{json .Config.User}},"privileged":{{json .HostConfig.Privileged}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"cap_add":{{json .HostConfig.CapAdd}},"cap_drop":{{json .HostConfig.CapDrop}},"security_opt":{{json .HostConfig.SecurityOpt}},"restart":{{json .HostConfig.RestartPolicy.Name}},"tmpfs":{{json .HostConfig.Tmpfs}},"port_bindings":{{json .HostConfig.PortBindings}}' "$1"
}

docker_caddy_bind_matches() {
  local host_hash mounted_hash
  [[ -f "$DOCKER_CADDY_MAIN" && ! -L "$DOCKER_CADDY_MAIN" && "$(readlink -f -- "$DOCKER_CADDY_MAIN")" == "$DOCKER_CADDY_MAIN" ]] || return 1
  host_hash="$(sha256sum -- "$DOCKER_CADDY_MAIN")";host_hash="${host_hash%% *}"
  mounted_hash="$(docker exec "$DOCKER_CADDY_ID" sha256sum /etc/caddy/Caddyfile)" || return 1
  mounted_hash="${mounted_hash%% *}"
  [[ "$host_hash" == "$mounted_hash" ]]
}

detect_regam_docker_caddy() {
  local ids metadata values version all_ids side_ids
  command -v docker >/dev/null 2>&1 || return 1
  ids="$(docker ps --no-trunc --filter status=running --filter label=com.docker.compose.project=regam-live --filter label=com.docker.compose.service=caddy --format '{{.ID}}' 2>/dev/null)" || return 1
  [[ -n "$ids" ]] || return 1
  [[ "$ids" =~ ^[a-f0-9]{64}$ ]] || fail "Plusieurs conteneurs Caddy REGAM Live sont actifs. Vérification manuelle requise."
  [[ -f "$DOCKER_GUARD" ]] || fail "scripts/docker_guard.py est absent du clone."
  DOCKER_CADDY_ID="$ids"
  docker_metadata "$DOCKER_CADDY_ID" >"$WORK_DIR/docker-caddy.json" || fail "Inspection du Caddy Docker impossible."
  values="$(python3 "$DOCKER_GUARD" live "$WORK_DIR/docker-caddy.json" "$DOCKER_CADDY_MAIN")" || fail "Le proxy Docker ne correspond pas au mode direct REGAM Live pris en charge."
  mapfile -t metadata <<< "$values"
  DOCKER_IMAGE="${metadata[0]}";DOCKER_NETWORK="${metadata[1]}";DOCKER_NETWORK_ID="${metadata[2]}"
  docker network inspect --format '{"id":{{json .Id}},"name":{{json .Name}},"driver":{{json .Driver}},"scope":{{json .Scope}},"internal":{{json .Internal}},"ingress":{{json .Ingress}},"project":{{json (index .Labels "com.docker.compose.project")}}' "$DOCKER_NETWORK" >"$WORK_DIR/docker-network.json" || fail "Réseau Docker inaccessible."
  python3 "$DOCKER_GUARD" network "$WORK_DIR/docker-network.json" "$DOCKER_NETWORK" "$DOCKER_NETWORK_ID" || fail "Réseau Docker personnalisé non pris en charge."
  version="$(docker exec "$DOCKER_CADDY_ID" caddy version)" || fail "Caddy ne répond pas dans le conteneur."
  [[ "$version" == v2.* ]] || fail "Seule cette disposition avec Caddy 2 est prise en charge."
  docker_caddy_bind_matches || fail "Le Caddyfile du conteneur diffère du fichier hôte ou son montage est inhabituel. Aucun conteneur LIVE ne sera recréé."
  # Docker may forward 80/443 with nftables and no socket visible in ss.
  all_ids="$(docker ps --no-trunc --format '{{.ID}}')" || fail "Impossible d'identifier tous les conteneurs actifs."
  side_ids="$(docker ps -a --no-trunc --filter "name=^/${DOCKER_SIDE_NAME}$" --format '{{.ID}}')" || fail "Impossible de contrôler le nom du conteneur statique."
  [[ -z "$side_ids" || "$side_ids" =~ ^[a-f0-9]{64}$ ]] || fail "Nom du conteneur statique ambigu."
  DOCKER_SIDE_ID="$side_ids"
  : >"$WORK_DIR/docker-ports.json"
  while IFS= read -r id; do
    [[ "$id" =~ ^[a-f0-9]{64}$ ]] || fail "Identifiant Docker inhabituel."
    docker container inspect --format '{"id":{{json .Id}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}' "$id" >>"$WORK_DIR/docker-ports.json" || fail "Un conteneur a changé pendant le contrôle. Relancez après sa stabilisation."
  done <<< "$all_ids"
  python3 "$DOCKER_GUARD" ports "$WORK_DIR/docker-ports.json" "$DOCKER_CADDY_ID" "$DOCKER_SIDE_ID" || fail "Les ports ou alias Docker entrent en conflit."
  return 0
}

check_docker_sidecar() {
  [[ "$SERVER" == caddy-docker ]] || return 0
  python3 "$DOCKER_GUARD" block "$DOCKER_CADDY_MAIN" "$STATE_DIR/deployment.json" "$DOMAIN" || fail "Le bloc Academy existant ne peut pas être remplacé."
  if [[ -n "$DOCKER_SIDE_ID" ]]; then
    [[ -f "$STATE_DIR/deployment.json" ]] || fail "Le nom regam-bac-maths est occupé sans état Academy enregistré."
    docker_metadata "$DOCKER_SIDE_ID" >"$WORK_DIR/docker-side.json" || fail "Inspection du conteneur statique impossible."
    python3 "$DOCKER_GUARD" side "$WORK_DIR/docker-side.json" "$DEPLOY_BASE" "$DOCKER_NETWORK" "$DOCKER_NETWORK_ID" "$STATE_DIR/deployment.json" || fail "Le conteneur statique existant exige une vérification manuelle."
    DOCKER_SIDE_IMAGE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["image"])' "$WORK_DIR/docker-side.json")"
  fi
}

detect_server() {
  local listeners service_exec caddy_exec_re
  SERVER=''
  running apache2 && fail "Apache est actif. Préparez un vhost séparé pour ce site avec l'administrateur du VPS ; aucun changement effectué."
  running httpd && fail "Apache/httpd est actif. Aucun changement effectué."
  if running caddy; then CADDY_WAS_RUNNING=1; SERVER=caddy; fi
  if running nginx; then
    NGINX_WAS_RUNNING=1
    [[ -z "$SERVER" ]] || fail "Caddy et Nginx sont actifs ensemble. Une intégration adaptée à ce montage est nécessaire."
    SERVER=nginx
  fi
  listeners="$(ss -H -ltnp '( sport = :80 or sport = :443 )' 2>/dev/null)"
  if [[ -z "$SERVER" ]] && detect_regam_docker_caddy; then
    SERVER=caddy-docker
  fi
  if [[ -n "$listeners" ]]; then
    [[ -n "$SERVER" ]] || fail "Les ports 80/443 sont utilisés par un autre processus ou un conteneur. Aucun service existant ne sera arrêté."
    while IFS= read -r listener; do
      if [[ "$SERVER" == caddy-docker ]]; then
        [[ "$listener" == *'"docker-proxy"'* ]] || fail "Un listener 80/443 n'appartient pas au proxy Docker reconnu. Aucun service ne sera arrêté."
      else
        [[ "$listener" == *"\"$SERVER\""* ]] || fail "Un autre processus utilise 80/443. Vérifiez le proxy ou les conteneurs avant l'installation."
      fi
    done <<< "$listeners"
  fi
  case "$SERVER" in
    caddy)
      [[ -f "$CADDY_MAIN" && ! -L "$CADDY_MAIN" ]] || fail "Configuration Caddy non standard : /etc/caddy/Caddyfile doit être un fichier normal."
      service_exec="$(systemctl show caddy -p ExecStart --value)"
      caddy_exec_re='--config[[:space:]]/etc/caddy/Caddyfile([[:space:];]|$)'
      [[ "$service_exec" =~ $caddy_exec_re && "$service_exec" != *'--resume'* ]] || fail "Caddy utilise une configuration personnalisée ou son API. Installation automatique arrêtée."
      ;;
    nginx)
      service_exec="$(systemctl show nginx -p ExecStart --value)"
      [[ "$service_exec" != *' -c'* ]] || fail "Nginx utilise un fichier de configuration non standard. Intégration manuelle requise."
      ;;
    '')
      if command -v caddy >/dev/null 2>&1 || command -v nginx >/dev/null 2>&1 || [[ -e /etc/nginx/nginx.conf || -e "$CADDY_MAIN" ]]; then
        fail "Un serveur web est installé mais inactif. Rétablissez d'abord son état prévu. Le script ne le remplace pas."
      fi
      SERVER=nginx
      ;;
  esac
}

check_managed_paths() {
  local saved_domain
  if [[ -e "$STATE_DIR" || -L "$STATE_DIR" ]]; then
    [[ -d "$STATE_DIR" && ! -L "$STATE_DIR" && -f "$STATE_DIR/.regam-managed" ]] || fail "$STATE_DIR existe sans marqueur d'appartenance REGAM."
    [[ "$(cat "$STATE_DIR/.regam-managed")" == REGAM_BAC_MATHS_V1 ]] || fail "Marqueur d'état REGAM non reconnu."
  fi
  if [[ -e "$DEPLOY_BASE" || -L "$DEPLOY_BASE" ]]; then
    [[ -d "$DEPLOY_BASE" && ! -L "$DEPLOY_BASE" && -f "$DEPLOY_BASE/.regam-managed" ]] || fail "$DEPLOY_BASE existe et n'appartient pas à cet installateur."
    [[ "$(cat "$DEPLOY_BASE/.regam-managed")" == REGAM_BAC_MATHS_V1 ]] || fail "Marqueur du dossier d'installation non reconnu."
  fi
  if [[ -e "$DEPLOY_BASE/current" && ! -L "$DEPLOY_BASE/current" ]]; then
    fail "current est un dossier ou fichier ordinaire ; aucun remplacement automatique."
  fi
  if [[ -L "$DEPLOY_BASE/current" ]]; then
    local existing_current
    existing_current="$(readlink -f -- "$DEPLOY_BASE/current" 2>/dev/null || true)"
    [[ -d "$existing_current" && "$(dirname -- "$existing_current")" == "$DEPLOY_BASE/releases" ]] || fail "Le lien current existant ne pointe pas vers une version REGAM valide."
  fi
  [[ ! -L "$DEPLOY_BASE/releases" && ! -L "$STATE_DIR/backups" ]] || fail "Un dossier de versions ou de sauvegardes est un lien symbolique."
  [[ ! -L /etc/caddy/regam-bac-maths.d ]] || fail "Le dossier de configuration Caddy REGAM est un lien symbolique."
  if [[ -f "$STATE_DIR/deployment.json" ]]; then
    saved_domain="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["domain"])' "$STATE_DIR/deployment.json")"
    [[ "$saved_domain" == "$DOMAIN" ]] || fail "Ce VPS possède déjà cette installation pour $saved_domain. Le changement de domaine exige une migration explicite."
  fi
  local conf
  for conf in "$CADDY_SITE" "$NGINX_SITE"; do
    if [[ -e "$conf" || -L "$conf" ]]; then
      [[ -f "$conf" && ! -L "$conf" ]] || fail "$conf n'est pas un fichier ordinaire."
      grep -Fxq "$MANAGED_MARKER" "$conf" || fail "$conf existe sans marqueur REGAM. Refus de l'écraser."
      [[ -f "$STATE_DIR/deployment.json" ]] || fail "Une configuration REGAM existe sans état d'installation. Faites contrôler ce précédent essai avant de poursuivre."
    fi
  done
  local hook=/etc/letsencrypt/renewal-hooks/deploy/regam-bac-maths-nginx.sh
  if [[ -e "$hook" || -L "$hook" ]]; then
    [[ -f "$hook" && ! -L "$hook" ]] && grep -Fxq "$MANAGED_MARKER" "$hook" || fail "Un hook de renouvellement non géré existe déjà avec ce nom."
  fi
}

check_dns() {
  python3 - "$DOMAIN" <<'PY'
import ipaddress,json,socket,subprocess,sys
domain=sys.argv[1]
try:
    ips={ipaddress.ip_address(x[4][0].split('%')[0]) for x in socket.getaddrinfo(domain,443,type=socket.SOCK_STREAM)}
    interfaces=json.loads(subprocess.check_output(['ip','-j','address','show'],text=True))
    local={ipaddress.ip_address(a['local']) for i in interfaces for a in i.get('addr_info',[])}
except Exception as exc:
    sys.exit('ERREUR: résolution DNS ou interfaces indisponibles : '+str(exc))
if not ips or any(not i.is_global for i in ips):
    sys.exit('ERREUR: le domaine doit avoir une adresse DNS publique. Aucun changement effectué.')
unexpected=ips-local
if unexpected:
    sys.exit('ERREUR: le DNS A/AAAA ne pointe pas directement vers les adresses de ce VPS. Corrigez tous les enregistrements, désactivez temporairement un proxy CDN, puis relancez. Aucun changement effectué.')
print('DNS OK : les adresses A/AAAA résolues appartiennent à ce VPS.')
PY
}

check_domain_collision() {
  if [[ "$SERVER" == caddy-docker ]]; then
    docker exec "$DOCKER_CADDY_ID" caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile >"$WORK_DIR/caddy-existing.json" 2>"$WORK_DIR/caddy-check.log" || fail "Le Caddyfile Docker existant ne peut pas être analysé. Aucun changement effectué."
    python3 "$DOCKER_GUARD" collision "$WORK_DIR/caddy-existing.json" "$DOMAIN" "$DOCKER_CADDY_MAIN" "$STATE_DIR/deployment.json" || fail "Domaine déjà utilisé ou bloc Academy non reconnu."
  elif [[ "$SERVER" == caddy ]]; then
    caddy adapt --config "$CADDY_MAIN" --adapter caddyfile >"$WORK_DIR/caddy-existing.json" 2>"$WORK_DIR/caddy-check.log" || fail "Le Caddyfile existant ne peut pas être analysé. Aucun changement effectué."
    python3 - "$WORK_DIR/caddy-existing.json" "$DOMAIN" "$STATE_DIR/deployment.json" "$CADDY_SITE" <<'PY'
import fnmatch,json,os,sys
tree=json.load(open(sys.argv[1])); domain=sys.argv[2]; matches=[]
def walk(x):
    if isinstance(x,dict):
        for h in x.get('host',[]):
            if isinstance(h,str) and fnmatch.fnmatchcase(domain,h.lower()): matches.append(h)
        for v in x.values(): walk(v)
    elif isinstance(x,list):
        for v in x: walk(v)
walk(tree)
owned=os.path.isfile(sys.argv[3]) and os.path.isfile(sys.argv[4])
if matches and not (owned and matches==[domain]):
    sys.exit('ERREUR: ce domaine correspond déjà à un hôte Caddy existant. Choisissez un nouveau sous-domaine.')
PY
  elif [[ "$NGINX_WAS_RUNNING" -eq 1 ]]; then
    nginx -T >"$WORK_DIR/nginx-existing.txt" 2>"$WORK_DIR/nginx-check.log" || fail "La configuration Nginx existante n'est pas valide. Aucun changement effectué."
    python3 - "$WORK_DIR/nginx-existing.txt" "$DOMAIN" "$NGINX_SITE" <<'PY'
import fnmatch,os,re,sys
text=open(sys.argv[1]).read(); domain=sys.argv[2]; own=os.path.realpath(sys.argv[3]); other=[]
for block in re.split(r'(?m)^# configuration file ',text):
    head,_,body=block.partition('\n'); path=head.rstrip(':')
    if os.path.realpath(path)==own:continue
    other.append(re.sub(r'(?m)#.*$','',body))
for value in re.findall(r'\bserver_name\s+([^;]+);','\n'.join(other)):
    for host in value.split():
        host=host.strip('"\'').lower()
        if host.startswith('~') or '$' in host:
            sys.exit('ERREUR: un server_name Nginx utilise une expression régulière ou une variable. Vérification manuelle des collisions requise.')
        if host==domain or fnmatch.fnmatchcase(domain,host) or (host.startswith('.') and (domain==host[1:] or domain.endswith(host))):
            sys.exit('ERREUR: ce domaine est déjà couvert par un autre vhost Nginx. Choisissez un sous-domaine distinct.')
PY
  fi
}

atomic_current() {
  local target="$1" link="$DEPLOY_BASE/.current-new-$$"
  [[ "$(dirname -- "$target")" == "$DEPLOY_BASE/releases" && -d "$target" && ! -L "$target" && "$(readlink -f -- "$target")" == "$target" ]] || return 1
  # Relative to the deployment directory, so the link also resolves in /srv
  # when this directory is mounted read-only in the isolated static container.
  ln -s -- "releases/$(basename -- "$target")" "$link"
  mv -Tf -- "$link" "$DEPLOY_BASE/current"
}

snapshot_file() {
  local src="$1" name="$2"
  if [[ -e "$src" ]]; then cp -a -- "$src" "$BACKUP_DIR/$name"; else : >"$BACKUP_DIR/$name.absent"; fi
}

restore_file() {
  local dest="$1" name="$2"
  if [[ -f "$BACKUP_DIR/$name.absent" ]]; then
    # These are exact managed configuration files, never checkout directories.
    rm -f -- "$dest"
  elif [[ -e "$BACKUP_DIR/$name" ]]; then
    cp -a -- "$BACKUP_DIR/$name" "$dest"
  fi
}

write_atomic() {
  local src="$1" dest="$2" tmp
  mkdir -p -- "$(dirname -- "$dest")"
  tmp="$(mktemp "$(dirname -- "$dest")/.regam-config.XXXXXX")"
  install -m 0644 -- "$src" "$tmp"
  if [[ -f "$dest" && ! -L "$dest" ]]; then
    chmod --reference="$dest" "$tmp"
    chown --reference="$dest" "$tmp"
  fi
  mv -Tf -- "$tmp" "$dest"
}

reload_server() {
  if [[ "$SERVER" == caddy-docker ]]; then
    docker_caddy_bind_matches || return 1
    docker exec "$DOCKER_CADDY_ID" caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>"$WORK_DIR/caddy-reload.log" || return 1
    docker exec "$DOCKER_CADDY_ID" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >>"$WORK_DIR/caddy-reload.log" 2>&1
  elif [[ "$SERVER" == caddy ]]; then
    caddy adapt --config "$CADDY_MAIN" --adapter caddyfile >/dev/null 2>"$WORK_DIR/caddy-reload.log" || return 1
    # Caddy reload provisions the new configuration atomically in the running
    # process. A failed reload leaves the previous active configuration running.
    systemctl reload caddy
  else
    nginx -t >"$WORK_DIR/nginx-reload.log" 2>&1 || return 1
    if running nginx; then systemctl reload nginx; else systemctl enable --now nginx; fi
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT
  set +e
  if [[ "$rc" -ne 0 && "$COMMITTED" -eq 0 ]]; then
    if [[ "$CURRENT_CHANGED" -eq 1 ]]; then
      if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then atomic_current "$PREVIOUS"; else rm -f -- "$DEPLOY_BASE/current"; fi
    fi
    if [[ "$CONFIG_CHANGED" -eq 1 && -n "$BACKUP_DIR" ]]; then
      if [[ "$SERVER" == caddy-docker ]]; then
        python3 "$DOCKER_GUARD" write "$BACKUP_DIR/Docker-Caddyfile" "$DOCKER_CADDY_MAIN" || say "ATTENTION : restauration du Caddyfile Docker non confirmée." >&2
      elif [[ "$SERVER" == caddy ]]; then
        restore_file "$CADDY_MAIN" Caddyfile
        restore_file "$CADDY_SITE" site.caddy
      else
        restore_file "$NGINX_SITE" nginx.conf
        restore_file /etc/letsencrypt/renewal-hooks/deploy/regam-bac-maths-nginx.sh renewal-hook.sh
      fi
      if ! reload_server; then
        say "ATTENTION : rechargement de restauration non confirmé. Vérifiez le service. Sauvegarde : $BACKUP_DIR" >&2
      fi
    fi
    if [[ "$DOCKER_SIDE_CREATED" -eq 1 && "$DOCKER_SIDE_ID" =~ ^[a-f0-9]{64}$ ]]; then
      # Exact ID from this invocation, never a LIVE container or an adopted one.
      docker rm -f "$DOCKER_SIDE_ID" >/dev/null 2>&1 || say "ATTENTION : le nouveau conteneur Academy doit être contrôlé : $DOCKER_SIDE_ID" >&2
    fi
    if [[ -n "$BACKUP_DIR" ]]; then
      [[ -f "$WORK_DIR/caddy-reload.log" ]] && cp -- "$WORK_DIR/caddy-reload.log" "$BACKUP_DIR/caddy-reload.log"
      [[ -f "$WORK_DIR/nginx-reload.log" ]] && cp -- "$WORK_DIR/nginx-reload.log" "$BACKUP_DIR/nginx-reload.log"
      say "Installation non terminée. Sauvegarde et diagnostic : $BACKUP_DIR" >&2
      say "Les versions de cours restent conservées. Les dépendances installées sont laissées en place." >&2
    fi
  fi
  # WORK_DIR is only a directory created by this invocation under /tmp.
  if [[ "$WORK_DIR" == /tmp/regam-bac-installer.* && -d "$WORK_DIR" ]]; then
    rm -f -- "$WORK_DIR"/*.json "$WORK_DIR"/*.txt "$WORK_DIR"/*.log "$WORK_DIR"/*.conf "$WORK_DIR"/*.caddy "$WORK_DIR"/Caddyfile "$WORK_DIR"/Docker-Caddyfile
    rmdir -- "$WORK_DIR" 2>/dev/null || true
  fi
  exit "$rc"
}

install_dependencies() {
  local -a missing=()
  command -v curl >/dev/null 2>&1 || missing+=(curl)
  command -v python3 >/dev/null 2>&1 || missing+=(python3)
  if [[ "$SERVER" == nginx ]]; then
    command -v nginx >/dev/null 2>&1 || missing+=(nginx)
    command -v certbot >/dev/null 2>&1 || missing+=(certbot)
  fi
  if [[ "${#missing[@]}" -gt 0 ]]; then
    require_command apt-get
    say "Installation des dépendances nécessaires : ${missing[*]}"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" ca-certificates
  fi
}

stage_release() {
  local stamp digest
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  digest="$(python3 - "$SITE_DIR" <<'PY'
import hashlib,pathlib,sys
p=pathlib.Path(sys.argv[1]);h=hashlib.sha256()
for f in sorted(p.rglob('*')):
    if not f.is_file():continue
    h.update(f.relative_to(p).as_posix().encode()+b'\0')
    with f.open('rb') as s:
        for b in iter(lambda:s.read(1048576),b''):h.update(b)
print(h.hexdigest())
PY
)"
  mkdir -p -- "$DEPLOY_BASE/releases" "$STATE_DIR/backups"
  chmod 0755 "$DEPLOY_BASE" "$DEPLOY_BASE/releases"
  chmod 0700 "$STATE_DIR" "$STATE_DIR/backups"
  printf '%s\n' REGAM_BAC_MATHS_V1 >"$DEPLOY_BASE/.regam-managed"
  printf '%s\n' REGAM_BAC_MATHS_V1 >"$STATE_DIR/.regam-managed"
  BACKUP_DIR="$(mktemp -d "$STATE_DIR/backups/$stamp.XXXXXX")"
  RELEASE="$(mktemp -d "$DEPLOY_BASE/releases/$stamp-${digest:0:12}.XXXXXX")"
  cp -a -- "$SITE_DIR/." "$RELEASE/"
  EXPECTED_HEALTH="regam-bac-maths:$digest"
  printf '%s\n' "$EXPECTED_HEALTH" >"$RELEASE/regam-health.txt"
  chown -R root:root "$RELEASE"
  find "$RELEASE" -type d -exec chmod 0755 {} +
  find "$RELEASE" -type f -exec chmod 0644 {} +
  PREVIOUS=''
  if [[ -L "$DEPLOY_BASE/current" ]]; then PREVIOUS="$(readlink -f -- "$DEPLOY_BASE/current")";fi
  [[ -z "$PREVIOUS" || "$PREVIOUS" == "$DEPLOY_BASE/releases/"* ]] || fail "Le lien current ne pointe pas vers une version gérée."
  snapshot_file "$STATE_DIR/deployment.json" deployment.json
  if [[ "$SERVER" == caddy-docker ]]; then
    snapshot_file "$DOCKER_CADDY_MAIN" Docker-Caddyfile
  elif [[ "$SERVER" == caddy ]]; then
    snapshot_file "$CADDY_MAIN" Caddyfile
    snapshot_file "$CADDY_SITE" site.caddy
  else
    snapshot_file "$NGINX_SITE" nginx.conf
    snapshot_file /etc/letsencrypt/renewal-hooks/deploy/regam-bac-maths-nginx.sh renewal-hook.sh
  fi
  atomic_current "$RELEASE"
  CURRENT_CHANGED=1
}

configure_caddy() {
  cat >"$WORK_DIR/site.caddy" <<CADDY
$MANAGED_MARKER
$DOMAIN {
    root * $DEPLOY_BASE/current
    tls $EMAIL
    encode zstd gzip
    header X-Content-Type-Options nosniff
    header Referrer-Policy strict-origin-when-cross-origin
    @health path /regam-health.txt
    header @health Cache-Control "no-store"
    @index path / /index.html
    header @index Cache-Control "no-cache"
    file_server
}

CADDY
  cp -- "$CADDY_MAIN" "$WORK_DIR/Caddyfile"
  if ! grep -Fxq "$IMPORT_LINE" "$WORK_DIR/Caddyfile"; then
    printf '\n%s\n%s\n' '# REGAM_BAC_MATHS_IMPORT_V1' "$IMPORT_LINE" >>"$WORK_DIR/Caddyfile"
  fi
  CONFIG_CHANGED=1
  write_atomic "$WORK_DIR/site.caddy" "$CADDY_SITE"
  write_atomic "$WORK_DIR/Caddyfile" "$CADDY_MAIN"
  reload_server || fail "Caddy a refusé la configuration. Restauration des fichiers précédents."
}

start_docker_sidecar() {
  local response attempt body=''
  if [[ -z "$DOCKER_SIDE_ID" ]]; then
    response="$(docker create --name "$DOCKER_SIDE_NAME" --label online.regam.bac-maths=REGAM_BAC_MATHS_V1 \
      --restart unless-stopped --user 65534:65534 --network "$DOCKER_NETWORK" --network-alias "$DOCKER_SIDE_NAME" \
      --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 64 \
      --tmpfs /tmp:rw,nosuid,nodev,noexec,uid=65534,gid=65534,mode=0700,size=16m \
      --tmpfs /config:rw,nosuid,nodev,noexec,uid=65534,gid=65534,mode=0700,size=16m \
      --tmpfs /data:rw,nosuid,nodev,noexec,uid=65534,gid=65534,mode=0700,size=16m \
      --mount "type=bind,source=$DEPLOY_BASE,target=/srv,readonly" --entrypoint caddy --pull never \
      "$DOCKER_IMAGE" file-server --root /srv/current --listen :8080)" || fail "Création du serveur statique isolé impossible."
    [[ "$response" =~ ^[a-f0-9]{64}$ ]] || fail "Docker n'a pas retourné l'identifiant attendu du nouveau conteneur."
    DOCKER_SIDE_ID="$response";DOCKER_SIDE_IMAGE="$DOCKER_IMAGE";DOCKER_SIDE_CREATED=1
    docker start "$DOCKER_SIDE_ID" >/dev/null || fail "Le nouveau serveur statique n'a pas démarré."
  fi
  for attempt in {1..15}; do
    body="$(docker exec "$DOCKER_CADDY_ID" wget -T 3 -q -O - "http://$DOCKER_SIDE_NAME:8080/regam-health.txt" 2>/dev/null)" || true
    [[ "$body" == "$EXPECTED_HEALTH" ]] && return 0
    sleep 1
  done
  fail "Le proxy LIVE ne peut pas lire la nouvelle version du serveur statique. Sa configuration n'a pas été modifiée."
}

configure_docker_caddy() {
  start_docker_sidecar
  docker_caddy_bind_matches || fail "Le fichier monté de Caddy a changé pendant l'installation."
  python3 "$DOCKER_GUARD" draft "$DOCKER_CADDY_MAIN" "$WORK_DIR/Docker-Caddyfile" "$DOMAIN" "$EMAIL" "$DOCKER_SIDE_NAME" "$STATE_DIR/deployment.json" || fail "Préparation du bloc Caddy impossible."
  # Validate in the actual Caddy image before touching its read-only bind source.
  docker exec -i "$DOCKER_CADDY_ID" caddy adapt --config /dev/stdin --adapter caddyfile <"$WORK_DIR/Docker-Caddyfile" >/dev/null 2>"$WORK_DIR/caddy-check.log" || fail "Le nouveau Caddyfile n'est pas accepté."
  CONFIG_CHANGED=1
  # Never rename this file: a file bind mount keeps the old inode after rename.
  python3 "$DOCKER_GUARD" write "$WORK_DIR/Docker-Caddyfile" "$DOCKER_CADDY_MAIN" || fail "Écriture du Caddyfile lié impossible."
  reload_server || fail "Caddy Docker a refusé le rechargement. Restauration du fichier précédent."
}

nginx_common() {
  cat <<NGINX
    root $DEPLOY_BASE/current;
    index index.html;
    charset utf-8;
    autoindex off;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location = /regam-health.txt { add_header Cache-Control "no-store" always; }
    location = /index.html { add_header Cache-Control "no-cache" always; }
    location ~ /\. { deny all; }
    location / { try_files \$uri \$uri/ =404; }
NGINX
}

nginx_draft() {
  local tls="$1" cert="$2" challenge="$3"
  printf '%s\n' "$MANAGED_MARKER"
  cat <<NGINX
server {
    listen 80;
NGINX
  if [[ -r /proc/net/if_inet6 ]] && grep -q '[[:xdigit:]]' /proc/net/if_inet6; then printf '    listen [::]:80;\n';fi
  cat <<NGINX
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ {
        root $challenge;
        default_type text/plain;
        try_files \$uri =404;
    }
NGINX
  if [[ "$tls" == yes ]]; then
    printf '    location / { return 301 https://$host$request_uri; }\n}\n'
    cat <<NGINX
server {
    listen 443 ssl;
NGINX
    if [[ -r /proc/net/if_inet6 ]] && grep -q '[[:xdigit:]]' /proc/net/if_inet6; then printf '    listen [::]:443 ssl;\n';fi
    cat <<NGINX
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$cert/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$cert/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
NGINX
  fi
  nginx_common
  printf '}\n'
}

configure_nginx() {
  local cert="regam-bac-maths-$DOMAIN" challenge="$DEPLOY_BASE/acme" initial=no
  mkdir -p -- "$challenge/.well-known/acme-challenge"
  chmod 0755 "$challenge" "$challenge/.well-known" "$challenge/.well-known/acme-challenge"
  if [[ -f "/etc/letsencrypt/renewal/$cert.conf" && ! -f "$STATE_DIR/certificates/$cert" ]]; then
    fail "Un certificat portant ce nom existe déjà sans état REGAM. Vérification manuelle requise."
  fi
  if [[ -f "/etc/letsencrypt/live/$cert/fullchain.pem" && -f "/etc/letsencrypt/live/$cert/privkey.pem" ]]; then initial=yes; fi
  nginx_draft "$initial" "$cert" "$challenge" >"$WORK_DIR/nginx.conf"
  CONFIG_CHANGED=1
  write_atomic "$WORK_DIR/nginx.conf" "$NGINX_SITE"
  reload_server || fail "Nginx a refusé le vhost. Restauration de sa configuration précédente."
  mkdir -p -- "$STATE_DIR/certificates"
  chmod 0700 "$STATE_DIR/certificates"
  printf '%s\n' "$DOMAIN" >"$STATE_DIR/certificates/$cert"
  # Webroot obtains the certificate without modifying other Nginx vhosts.
  certbot certonly --webroot --webroot-path "$challenge" --non-interactive --agree-tos \
    --email "$EMAIL" --cert-name "$cert" --domain "$DOMAIN" --keep-until-expiring \
    || fail "Certificat non obtenu. Vérifiez DNS, ports 80/443 et quotas ACME, puis relancez."
  nginx_draft yes "$cert" "$challenge" >"$WORK_DIR/nginx.conf"
  write_atomic "$WORK_DIR/nginx.conf" "$NGINX_SITE"
  reload_server || fail "La configuration HTTPS Nginx n'a pas été acceptée."
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  local hook=/etc/letsencrypt/renewal-hooks/deploy/regam-bac-maths-nginx.sh
  if [[ -e "$hook" ]] && ! grep -Fxq "$MANAGED_MARKER" "$hook"; then fail "Un hook de renouvellement existe déjà avec ce nom."; fi
  cat >"$hook" <<HOOK
#!/usr/bin/env bash
$MANAGED_MARKER
set -euo pipefail
case "\${RENEWED_LINEAGE:-}" in
  /etc/letsencrypt/live/regam-bac-maths-*) nginx -t && systemctl reload nginx ;;
esac
HOOK
  chmod 0755 "$hook"
  if systemctl list-unit-files certbot.timer --no-legend 2>/dev/null | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
  fi
}

verify_https() {
  local deadline=$((SECONDS+180)) body=''
  say "Vérification de HTTPS et de la version réellement servie…"
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    if body="$(curl --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 6 \
      --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/regam-health.txt" 2>/dev/null)" && [[ "$body" == "$EXPECTED_HEALTH" ]]; then
      break
    fi
    sleep 2
  done
  [[ "$body" == "$EXPECTED_HEALTH" ]] || fail "Le certificat HTTPS ou la version du site n'a pas pu être confirmé dans le délai prévu."
  body="$(curl --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 15 "https://$DOMAIN/regam-health.txt")" \
    || fail "La vérification via le domaine public a échoué."
  [[ "$body" == "$EXPECTED_HEALTH" ]] || fail "Le domaine public ne sert pas la version attendue."
  curl --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 15 "https://$DOMAIN/" >"$WORK_DIR/index.txt" \
    || fail "La page d'accueil ne répond pas correctement."
  grep -qi REGAM "$WORK_DIR/index.txt" || fail "La page d'accueil servie n'est pas REGAM Academy."
}

save_state() {
  python3 - "$STATE_DIR/deployment.json" "$DOMAIN" "$SERVER" "$RELEASE" "$PREVIOUS" "$EXPECTED_HEALTH" "$BACKUP_DIR" "$DOCKER_SIDE_ID" "$DOCKER_SIDE_IMAGE" <<'PY'
import datetime,json,os,pathlib,sys,tempfile
p=pathlib.Path(sys.argv[1]); record=dict(domain=sys.argv[2],server=sys.argv[3],current=sys.argv[4],previous=sys.argv[5],health=sys.argv[6],backup=sys.argv[7],updated_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
if record['server']=='caddy-docker':
    record.update(static_container_id=sys.argv[8],static_image=sys.argv[9])
fd,tmp=tempfile.mkstemp(prefix='.deployment-',dir=str(p.parent))
with os.fdopen(fd,'w') as f:json.dump(record,f,indent=2);f.write('\n')
os.chmod(tmp,0o600);os.replace(tmp,p)
PY
}

rollback_release() {
  [[ -f "$STATE_DIR/deployment.json" && -f "$DEPLOY_BASE/.regam-managed" ]] || fail "Aucune installation REGAM enregistrée."
  mapfile -t state < <(python3 - "$STATE_DIR/deployment.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]));print(s['domain']);print(s['server']);print(s['current']);print(s.get('previous',''));print(s.get('static_container_id',''));print(s.get('static_image',''))
PY
)
  DOMAIN="${state[0]}";SERVER="${state[1]}";PREVIOUS="${state[2]}";RELEASE="${state[3]:-}"
  DOCKER_SIDE_ID="${state[4]:-}";DOCKER_SIDE_IMAGE="${state[5]:-}"
  [[ -n "$RELEASE" && "$RELEASE" == "$DEPLOY_BASE/releases/"* && -f "$RELEASE/regam-health.txt" ]] || fail "Aucune version précédente disponible."
  EXPECTED_HEALTH="$(cat "$RELEASE/regam-health.txt")"
  atomic_current "$RELEASE";CURRENT_CHANGED=1
  verify_https
  BACKUP_DIR="$(mktemp -d "$STATE_DIR/backups/rollback-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
  snapshot_file "$STATE_DIR/deployment.json" deployment.json
  save_state;COMMITTED=1
  say "DONE · Version précédente réactivée : https://$DOMAIN/"
}

main() {
  case "${1:-}" in
    -h|--help) usage;return 0 ;;
    --check|--check-only) MODE=check;shift ;;
    --rollback) MODE=rollback;shift ;;
    --*) usage;fail "Option inconnue : $1" ;;
  esac
  if [[ "$MODE" == rollback ]]; then
    [[ "$#" -eq 0 ]] || fail "--rollback n'accepte pas de domaine supplémentaire."
  elif [[ "$MODE" == check && "$#" -eq 0 ]]; then
    :
  elif [[ "$MODE" == install && "$#" -eq 0 ]]; then
    [[ "$EUID" -eq 0 ]] || fail "Ouvrez le terminal VPS en root, ou exécutez : sudo bash install.sh"
    prompt_install_details
  else
    [[ "$#" -eq 2 ]] || { usage;fail "Indiquez le nouveau domaine du site et l'email du certificat."; }
    DOMAIN="${1,,}";EMAIL="$2"
    validate_domain "$DOMAIN" || fail "Domaine invalide. Utilisez un nouveau sous-domaine réel, sans https://, chemin ou port ; pas le terminal Hostinger."
    validate_email "$EMAIL" || fail "Adresse email invalide."
  fi
  if [[ "$MODE" == check ]]; then
    validate_sources
    say 'CHECK OK · Sources complètes et syntaxe valide. Aucun fichier système modifié.'
    if [[ -r /etc/os-release ]]; then . /etc/os-release; say "Système détecté : ${PRETTY_NAME:-inconnu}"; fi
    if [[ ! -d /run/systemd/system ]]; then say 'Information : systemd absent ici ; ce contrôle local ne vaut pas une installation sur VPS.'; fi
    if [[ -n "$DOMAIN" ]]; then require_command python3;require_command ip;check_dns;fi
    say 'Ce contrôle ne crée aucun certificat et ne certifie pas une publication HTTPS.'
    return 0
  fi
  [[ "$EUID" -eq 0 ]] || fail "Ouvrez le terminal VPS en root, ou exécutez avec sudo bash install.sh …"
  check_platform
  WORK_DIR="$(mktemp -d /tmp/regam-bac-installer.XXXXXX)";chmod 0700 "$WORK_DIR"
  trap on_exit EXIT
  exec 9>/run/lock/regam-bac-maths-install.lock
  flock -n 9 || fail "Une installation REGAM est déjà en cours."
  if [[ "$MODE" == rollback ]]; then require_command curl;rollback_release;return 0;fi
  validate_sources
  detect_server
  check_managed_paths
  check_docker_sidecar
  check_dns
  check_domain_collision
  say "Précontrôle réussi. Serveur utilisé : $SERVER. Domaine : $DOMAIN."
  install_dependencies
  stage_release
  case "$SERVER" in
    caddy) configure_caddy ;;
    caddy-docker) configure_docker_caddy ;;
    nginx) configure_nginx ;;
  esac
  verify_https
  save_state
  COMMITTED=1
  say ''
  say "DONE · REGAM Academy est accessible : https://$DOMAIN/"
  say "Version : $(basename -- "$RELEASE")"
  say "Sauvegarde : $BACKUP_DIR"
  say "Retour à la version précédente : sudo bash $SCRIPT_DIR/install.sh --rollback"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@";fi
