#!/usr/bin/env bash
# REGAM Live - protects the server (Ubuntu / Debian). Run as root:
#     bash ~/regam-live-src/secure.sh
#
# What it does, and nothing else:
#   1. firewall (ufw): everything coming in is refused, except what is already in use on this server
#      (the remote access port, the web, the live video, and every port a program is listening on today,
#      so that no other site or service on this server stops working);
#   2. fail2ban: an address that fails to sign in to the server several times is blocked for an hour;
#   3. security updates of the system are installed by themselves every day.
# It does not change how you sign in to the server (password or key): see the notes it prints at the end.
# It can be run again at any time.
set -euo pipefail
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = "0" ] || { echo "Run this as root."; exit 1; }
command -v apt-get >/dev/null || { echo "This script is for Ubuntu / Debian."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Installing ufw, fail2ban, unattended-upgrades"
apt-get update -qq
apt-get install -y -qq ufw fail2ban unattended-upgrades >/dev/null

# ---------------------------------------------------------------- firewall --
# The port of the remote access (SSH), as it is configured on this server.
SSH_PORTS=$( (sshd -T 2>/dev/null | awk '$1=="port"{print $2}') || true)
[ -n "$SSH_PORTS" ] || SSH_PORTS=22

# Every port a program listens on today for the outside (not 127.0.0.1): kept open, so nothing breaks.
# Ports published by Docker are opened by Docker itself and are listed here only for your information.
LISTEN_TCP=$(ss -Hltn 2>/dev/null | awk '{print $4}' | grep -Ev '^(127\.|\[::1\])' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | tr '\n' ' ')
LISTEN_UDP=$(ss -Hlun 2>/dev/null | awk '{print $4}' | grep -Ev '^(127\.|\[::1\])' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | tr '\n' ' ')

say "Setting the firewall"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
for p in $SSH_PORTS; do ufw limit "$p/tcp" comment 'remote access (SSH)' >/dev/null; done
ufw allow 80/tcp comment 'web' >/dev/null
ufw allow 443/tcp comment 'web (https)' >/dev/null
ufw allow 443/udp comment 'web (http/3)' >/dev/null
ufw allow 8189/udp comment 'REGAM Live video' >/dev/null
ufw allow 8189/tcp comment 'REGAM Live video' >/dev/null
for p in $LISTEN_TCP; do
  case " $SSH_PORTS 80 443 8189 " in *" $p "*) continue ;; esac
  ufw allow "$p/tcp" comment 'in use when secure.sh ran' >/dev/null
done
for p in $LISTEN_UDP; do
  case " 443 8189 53 68 " in *" $p "*) continue ;; esac            # 53/68: name lookups and network setup, never from outside
  [ "$p" -ge 32768 ] && continue                                    # short-lived ports
  ufw allow "$p/udp" comment 'in use when secure.sh ran' >/dev/null
done
ufw --force enable >/dev/null

# ---------------------------------------------------------------- fail2ban --
say "Blocking repeated sign-in attempts (fail2ban)"
cat > /etc/fail2ban/jail.d/regam.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = $(echo "$SSH_PORTS" | tr ' \n' ',,' | sed 's/,*$//')
EOF
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban

# ------------------------------------------------------- security updates --
say "Security updates every day, by themselves"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

# ------------------------------------------------------------------ report --
say "Done. What is open now"
ufw status | sed 's/^/   /'
echo
echo "   Blocked addresses so far:  fail2ban-client status sshd"
echo
OTHER=$(for p in $LISTEN_TCP; do case " $SSH_PORTS 80 443 8189 " in *" $p "*) ;; *) printf '%s ' "$p" ;; esac; done)
if [ -n "$OTHER" ]; then
  echo "   Ports kept open because a program was using them: $OTHER"
  echo "   Send this list to whoever maintains the server: the ones that are not needed from outside can be closed."
fi
if sshd -T 2>/dev/null | grep -qi '^passwordauthentication yes'; then
  echo
  echo "   Signing in to this server with a password is still allowed. With fail2ban it is much harder to guess,"
  echo "   but use a long password (16 characters or more) that is used nowhere else."
fi
