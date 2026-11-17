#!/usr/bin/env bash
# REGAM Live - builds the desktop applications (Windows, Mac with Apple or Intel processor) for one site.
#     bash tools/build-apps.sh https://live.example.com /path/to/output
# Needs: node (with npm), zip, curl, tar. Run by install.sh inside a container; can be run by hand too.
# The applications open the given site in a window of their own. Author: Aziz Mernissi.
set -euo pipefail
SITE="${1:?site address, e.g. https://live.example.com}"
OUT="${2:?output directory}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON=33.2.1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$OUT" "$WORK/src" "$WORK/out"
cp "$HERE"/apps/desktop/* "$WORK/src/"
printf '{\n  "site": "%s"\n}\n' "${SITE%/}" > "$WORK/src/config.json"

cd "$WORK"
npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund --silent @electron/packager@18
pack() {   # platform arch [extra options]
  local platform="$1" arch="$2"; shift 2
  npx electron-packager "$WORK/src" "REGAM Live" --platform="$platform" --arch="$arch" --electron-version="$ELECTRON" --out="$WORK/out" --overwrite --asar --ignore=icon.icns "$@" >/dev/null
}

echo "   Windows"
pack win32 x64
( cd "$WORK/out" && mv "REGAM Live-win32-x64" "REGAM Live" && zip -qr "$OUT/REGAM-Live-Windows.zip.part" "REGAM Live" && rm -rf "REGAM Live" )
mv "$OUT/REGAM-Live-Windows.zip.part" "$OUT/REGAM-Live-Windows.zip"

# The Mac applications are signed "ad hoc" (no Apple developer account): without it a Mac with an Apple
# processor refuses to start them at all. macOS still asks the person to confirm the first opening.
curl -fsSL --max-time 120 -o "$WORK/rcs.tar.gz" "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.29.0/apple-codesign-0.29.0-$(uname -m)-unknown-linux-musl.tar.gz"
tar xzf "$WORK/rcs.tar.gz" -C "$WORK"
SIGN="$(find "$WORK" -maxdepth 2 -name rcodesign | head -1)"
for arch in arm64 x64; do
  echo "   Mac ($arch)"
  pack darwin "$arch" --icon="$WORK/src/icon.icns" --app-bundle-id=online.regam.live --app-category-type=public.app-category.education \
    --usage-description.Camera="REGAM Live utilise la caméra pendant vos lives." --usage-description.Microphone="REGAM Live utilise le micro pendant vos lives."
  "$SIGN" sign "$WORK/out/REGAM Live-darwin-$arch/REGAM Live.app" >/dev/null 2>&1
  ( cd "$WORK/out/REGAM Live-darwin-$arch" && zip -qry "$OUT/REGAM-Live-Mac-$arch.zip.part" "REGAM Live.app" )
  mv "$OUT/REGAM-Live-Mac-$arch.zip.part" "$OUT/REGAM-Live-Mac-$arch.zip"
  rm -rf "$WORK/out/REGAM Live-darwin-$arch"
done
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/built"
ls -la "$OUT" | awk 'NR>1 {print "   " $5, $9}'
