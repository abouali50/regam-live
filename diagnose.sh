#!/usr/bin/env bash
# REGAM Live - a short health report of the server, to find why a live went wrong.
#     bash ~/regam-live-src/diagnose.sh
# It only reads: nothing is changed, nothing is restarted, so it can be run during a live.
# No password, no key and no e-mail address is printed, and the addresses of the visitors are masked.
BASE=/opt/regam-live
HOURS="${1:-6}"
say() { printf '\n== %s\n' "$*"; }
mask() { sed -E 's/([0-9]{1,3}\.[0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}/\1.x.x/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/***@***/g'; }
cd "$BASE" 2>/dev/null || { echo "REGAM Live is not installed in $BASE"; exit 1; }
dc() { docker compose "$@" 2>/dev/null; }

say "Server"
date -u '+%Y-%m-%d %H:%M UTC'
echo "cores: $(nproc)   load: $(cut -d' ' -f1-3 /proc/loadavg)"
free -m | awk 'NR==2{printf "memory: %s MB used of %s MB\n",$3,$2} NR==3{printf "swap:   %s MB used of %s MB\n",$3,$2}'
df -h / | awk 'NR==2{print "disk:   "$3" used of "$2" ("$5")"}'
dmesg 2>/dev/null | grep -ci 'out of memory\|oom-kill' | sed 's/^/programs killed for lack of memory: /'

say "Programs"
dc ps --format 'table {{.Service}}\t{{.Status}}'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null | grep -i 'regam\|NAME'

say "Video ports (8189)"
ss -Hlun 2>/dev/null | grep -c ':8189 ' | sed 's/^/listening on UDP 8189: /'
ss -Hltn 2>/dev/null | grep -c ':8189 ' | sed 's/^/listening on TCP 8189: /'
if command -v ufw >/dev/null; then ufw status 2>/dev/null | grep -E '^Status|8189' ; fi
grep -E '^\s*webrtc(AdditionalHosts|LocalUDPAddress|LocalTCPAddress|IPsFromInterfaces)' deploy/mediamtx.yml 2>/dev/null

say "Video server, last $HOURS h"
M=$(dc logs --since "${HOURS}h" --no-log-prefix mediamtx)
count() { printf '%s' "$M" | grep -ci -- "$1"; }
echo "restarts:                        $(count 'MediaMTX v')"
echo "WebRTC sessions opened:          $(count 'WebRTC.*created by')"
echo "WebRTC sessions that connected:  $(count 'peer connection established')"
echo "WebRTC sessions closed in error: $(count 'WebRTC.*closed:')"
echo "   of which: no connection made: $(count 'deadline exceeded')"
echo "connected over UDP:              $(count 'established.*udp')"
echo "connected over TCP:              $(count 'established.*tcp')"
echo "HLS (spectators) errors:         $(count 'HLS.*\(ERR\|WAR\)')"
echo "lines marked ERR:                $(count ' ERR ')"
echo "lines marked WAR:                $(count ' WAR ')"
echo "-- the most frequent warnings and errors:"
printf '%s' "$M" | grep -E ' (ERR|WAR) ' | mask | sed -E 's/^[0-9/]+ [0-9:]+ //; s/\[[^]]*[0-9a-f]{6,}[^]]*\]/[..]/g; s/[0-9a-f]{8}-[0-9a-f-]{20,}/<id>/g' | cut -c1-170 | sort | uniq -c | sort -rn | head -15

say "Site, last $HOURS h"
A=$(dc logs --since "${HOURS}h" --no-log-prefix app)
echo "restarts:           $(printf '%s' "$A" | grep -c 'listening on')"
echo "e-mails not sent:   $(printf '%s' "$A" | grep -c 'e-mail failed')"
echo "-- last errors:"
printf '%s' "$A" | grep -iv 'listening on' | mask | cut -c1-220 | sort | uniq -c | sort -rn | head -15

say "Translation and reading voice"
for svc in translate tts; do
  st=$(dc ps --format '{{.Service}} {{.Status}}' | awk -v s="$svc" '$1==s{ $1=""; print substr($0,2) }')
  echo "$svc: ${st:-NOT RUNNING}"
done
dc exec -T app node -e '
const T = process.env.TRANSLATE_URL, V = process.env.TTS_URL;
(async () => {
  if (!T) console.log("translation: no TRANSLATE_URL"); else try {
    const r = await fetch(T + "/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "Bonjour a tous, merci d etre la.", source: "fr", target: "ar", format: "text" }), signal: AbortSignal.timeout(20000) });
    console.log("translation fr->ar:", r.status, (await r.text()).slice(0, 160));
  } catch (e) { console.log("translation: FAILED", e.message); }
  if (!V) console.log("voice: no TTS_URL"); else try {
    const h = await fetch(V + "/health", { signal: AbortSignal.timeout(8000) });
    console.log("voice health:", h.status, (await h.text()).slice(0, 160));
  } catch (e) { console.log("voice: FAILED", e.message); }
})();' 2>&1 | head -6
echo "-- translation service, last lines:"; dc logs --since "${HOURS}h" --no-log-prefix translate 2>&1 | grep -iv "^$" | tail -n 4 | cut -c1-160
echo "-- voice service, last lines:"; dc logs --since "${HOURS}h" --no-log-prefix tts 2>&1 | tail -n 4 | cut -c1-160

say "Front (Caddy / nginx), last $HOURS h"
if dc ps --services 2>/dev/null | grep -qx caddy && [ -n "$(dc ps -q caddy)" ]; then
  dc logs --since "${HOURS}h" --no-log-prefix caddy | grep -c '"level":"error"' | sed 's/^/caddy errors: /'
elif [ -f /var/log/nginx/error.log ]; then
  echo "nginx errors (whole file): $(wc -l < /var/log/nginx/error.log)"
  tail -n 400 /var/log/nginx/error.log | mask | sed -E 's/^[0-9/]+ [0-9:]+ //; s/, client:.*//' | cut -c1-150 | sort | uniq -c | sort -rn | head -6
fi
echo
echo "== End of the report. Copy everything from the first '== Server' line and send it."
