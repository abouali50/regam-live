#!/usr/bin/env bash
# ============================================================================
#  REGAM Live - installer (Ubuntu/Debian VPS)
#
#  Usage, as root, from the unzipped regam-live folder:
#     bash install.sh live.example.com you@example.com
#
#  Run it again with the same arguments after changing files to UPDATE.
#
#  Optional environment variables:
#     ADMIN_PASS=...        studio password (asked interactively if unset)
#     HOST_NAME="Pro"       name shown on the host's comments
#     QUALITY=1080|720      broadcast picture size (default 1080)
#     MODE=direct|proxy     force a mode instead of auto-detecting
#     FORCE=1               skip the DNS safety check
# ============================================================================
set -Eeuo pipefail

BASE="/opt/regam-live"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${1:-}"
EMAIL="${2:-}"
QUALITY="${QUALITY:-1080}"

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
trap 'die "Stopped at line $LINENO. Nothing below that line was executed."' ERR

[ "$(id -u)" -eq 0 ] || die "Run as root:  sudo bash install.sh <domain> <email>"
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || die "Usage: bash install.sh <domain> <email>"
[ -f "$SRC/server.js" ] || die "Run this script from inside the unzipped regam-live folder."
command -v apt-get >/dev/null || die "This installer supports Ubuntu/Debian only."
case "$QUALITY" in
  1080) W=1920; H=1080; VBITRATE=3500k; VBUF=7000k ;;
  720)  W=1280; H=720;  VBITRATE=2200k; VBUF=4400k ;;
  *) die "QUALITY must be 1080 or 720." ;;
esac

say "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates iproute2 openssl rsync >/dev/null
if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing. Install the 'docker-compose-plugin' package and run again."

# ------------------------------------------------------------ network facts --
PUBLIC_IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org || true)"
[ -n "$PUBLIC_IP" ] || PUBLIC_IP="$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')"
[ -n "$PUBLIC_IP" ] || die "Could not detect the public IP of this server."
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"

mkdir -p "$BASE"
# "direct" = nothing else uses ports 80/443, we bring our own web server (Caddy)
# "proxy"  = another web server already owns 80/443, we sit behind it
if [ -z "${MODE:-}" ] && [ -f "$BASE/.mode" ]; then MODE="$(cat "$BASE/.mode")"; fi
if [ -z "${MODE:-}" ]; then
  if ss -ltnH '( sport = :80 or sport = :443 )' | grep -q .; then MODE="proxy"; else MODE="direct"; fi
fi
[ "$MODE" = "direct" ] || [ "$MODE" = "proxy" ] || die "MODE must be 'direct' or 'proxy'."
echo "$MODE" > "$BASE/.mode"
say "Mode: $MODE   |   Server IP: $PUBLIC_IP   |   $DOMAIN -> ${DNS_IP:-not found}"
if [ "$DNS_IP" != "$PUBLIC_IP" ] && [ "${FORCE:-0}" != "1" ]; then
  die "DNS is not ready: create an A record  $DOMAIN -> $PUBLIC_IP , wait a few minutes, then run again. (FORCE=1 skips this check.)"
fi

# ------------------------------------------------------------------- files --
say "Copying the application to $BASE"
rsync -a --delete --exclude .git --exclude node_modules --exclude data --exclude .env --exclude .mode \
      --exclude 'deploy/mediamtx.yml' --exclude 'deploy/Caddyfile' --exclude 'test/out' "$SRC"/ "$BASE"/
cd "$BASE"
mkdir -p data deploy
chown -R 1000:1000 data

GENERATED=0
if [ ! -f .env ]; then
  if [ -z "${ADMIN_PASS:-}" ] && [ -t 0 ]; then
    read -r -s -p "Studio password, 8 characters or more (empty = generate one): " ADMIN_PASS; echo
  fi
  if [ -z "${ADMIN_PASS:-}" ]; then ADMIN_PASS="$(openssl rand -hex 8)"; GENERATED=1; fi
  [ "${#ADMIN_PASS}" -ge 8 ] || die "The studio password must have at least 8 characters."
  case "$ADMIN_PASS" in *[!A-Za-z0-9._@%+=:,-]*) die "Use only letters, digits and . _ @ % + = : , - in the studio password." ;; esac
  APP_PORT=3210
  while ss -ltnH "( sport = :$APP_PORT )" | grep -q .; do APP_PORT=$((APP_PORT + 1)); done
  umask 077
  cat > .env <<EOF
# REGAM Live settings. Change values here, then run install.sh again.
SITE_TITLE=REGAM Live
HOST_NAME=${HOST_NAME:-REGAM}
ADMIN_PASSWORD=$ADMIN_PASS
SECRET=$(openssl rand -hex 32)
MTX_USER=regam
MTX_PASS=$(openssl rand -hex 16)
APP_PORT=$APP_PORT
# Address of a CDN in front of https://$DOMAIN/hls (needed for thousands of viewers). Empty = no CDN.
HLS_PUBLIC_URL=
EOF
  umask 022
fi
getv() { grep -E "^$1=" .env | head -n1 | cut -d= -f2-; }
MTX_USER="$(getv MTX_USER)"; MTX_PASS="$(getv MTX_PASS)"; APP_PORT="$(getv APP_PORT)"

sed -e "s/__MTX_USER__/$MTX_USER/g" -e "s/__MTX_PASS__/$MTX_PASS/g" -e "s/__PUBLIC_IP__/$PUBLIC_IP/g" \
    -e "s/__W__/$W/g" -e "s/__H__/$H/g" -e "s/__VBITRATE__/$VBITRATE/g" -e "s/__VBUF__/$VBUF/g" \
    deploy/mediamtx.yml.tpl > deploy/mediamtx.yml
chmod 644 deploy/mediamtx.yml

PROFILE=()
if [ "$MODE" = "direct" ]; then
  PROFILE=(--profile direct)
  cat > deploy/Caddyfile <<EOF
{
	email $EMAIL
}
$DOMAIN {
	encode gzip
	reverse_proxy app:3000
}
EOF
else
  : > deploy/Caddyfile
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  say "Opening firewall ports (ufw)"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw allow 8189/udp >/dev/null; ufw allow 8189/tcp >/dev/null
fi

say "Building and starting REGAM Live (a few minutes the first time)"
docker compose "${PROFILE[@]}" up -d --build --remove-orphans

# ------------------------------------------------------ reverse proxy (opt) --
if [ "$MODE" = "proxy" ]; then
  if command -v nginx >/dev/null && [ -d /etc/nginx/sites-available ]; then
    say "Adding an nginx site for $DOMAIN"
    cat > /etc/nginx/sites-available/regam-live <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location /ws {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_read_timeout 3600s;
    }
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/regam-live /etc/nginx/sites-enabled/regam-live
    nginx -t && systemctl reload nginx
    if command -v certbot >/dev/null; then
      certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect -n \
        || warn "certbot failed; run:  certbot --nginx -d $DOMAIN"
    else
      warn "HTTPS is still missing, and the camera only works over HTTPS. Run:"
      warn "  apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN"
    fi
  else
    warn "Ports 80/443 are used by another web server that is not nginx."
    warn "Point it at http://127.0.0.1:$APP_PORT for $DOMAIN (with WebSocket support) and give it an HTTPS certificate."
  fi
fi

# ------------------------------------------------------------ quick health --
OK=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
[ "$OK" = 1 ] || warn "The app does not answer yet. Check:  cd $BASE && docker compose logs app mediamtx"

say "Done."
cat <<EOF

  REGAM Live
    Viewers:  https://$DOMAIN
    Studio:   https://$DOMAIN/studio      (use Google Chrome on the computer)
EOF
if [ "$GENERATED" = 1 ]; then printf '    Studio password: %s   <-- write it down now\n' "$ADMIN_PASS"; fi
cat <<EOF

  - Hosting panel firewall: open 80/tcp, 443/tcp and 8189/udp + 8189/tcp
    (8189 carries the live picture and sound from the studio and the guest).
  - Settings:  $BASE/.env  (then run this script again)
  - Logs:      cd $BASE && docker compose logs -f app mediamtx

EOF
