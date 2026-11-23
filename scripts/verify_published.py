#!/usr/bin/env python3
"""Verify a pinned Academy release manifest and every listed file.

Only the Python standard library is used. The manifest is authenticated by its
exact SHA-256 before JSON parsing. Media are checked byte for byte against the
files validated during release preparation; this script does not decode audio.

Published site:
  python3 scripts/verify_published.py https://academy.example.com \
      --expected-manifest <sha256-of-release-audio.json>

Offline development check:
  python3 scripts/verify_published.py --site site \
      --expected-manifest <sha256-of-release-audio.json>
"""

import argparse
from contextlib import contextmanager
import hashlib
import http.client
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


MANIFEST_NAME = "release-audio.json"
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_FILES = 512
CHUNK_BYTES = 64 * 1024
TIMEOUT_SECONDS = 30
HASH_PATTERN = re.compile(r"[0-9a-fA-F]{64}\Z")
PATH_COMPONENT = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*\Z")
REQUIRED_FILES = {
    "index.html": "page",
    "assets/app.js": "script",
    "assets/i18n.js": "script",
    "assets/style.css": "script",
    "data/courses.js": "script",
}


class VerificationError(Exception):
    """A failed verification, with a safe message suitable for the terminal."""


def valid_hash(value):
    return isinstance(value, str) and HASH_PATTERN.fullmatch(value) is not None


def safe_relative_path(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise VerificationError("Le manifeste contient un chemin absent ou trop long.")
    parts = value.split("/")
    if any(not PATH_COMPONENT.fullmatch(part) or part.endswith(".") for part in parts):
        raise VerificationError("Le manifeste contient un chemin non autorisé.")
    # The component grammar rejects absolute paths, ., .., backslashes, URL
    # schemes, percent escapes, query strings, fragments and control characters.
    return value


def https_origin(url):
    if not isinstance(url, str) or any(ord(char) <= 32 or ord(char) == 127 for char in url):
        raise VerificationError("L’adresse du site doit être une adresse HTTPS valide.")
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise VerificationError("L’adresse HTTPS du site est invalide.") from exc
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username is not None or parsed.password is not None:
        raise VerificationError("Une adresse HTTPS sans identifiant ni mot de passe est requise.")
    if not re.fullmatch(r"[A-Za-z0-9.:-]+", parsed.hostname) or port == 0:
        raise VerificationError("Le nom d’hôte ou le port HTTPS est invalide.")
    return parsed, ("https", parsed.hostname.lower(), 443 if port is None else port)


class SameOriginRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, origin):
        super().__init__()
        self.origin = origin

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _, destination = https_origin(newurl)
        if destination != self.origin:
            raise VerificationError("Redirection refusée vers une autre origine.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PublishedSource:
    def __init__(self, url):
        parsed, self.origin = https_origin(url)
        if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise VerificationError("Indiquez l’adresse racine du site, sans chemin, paramètre ni fragment.")
        self.base = urllib.parse.urlunsplit(("https", parsed.netloc, "/", "", ""))
        self.opener = urllib.request.build_opener(SameOriginRedirects(self.origin))
        self.local = False

    @contextmanager
    def open(self, relative, limit):
        safe_relative_path(relative)
        request = urllib.request.Request(
            self.base + relative,
            headers={"Accept-Encoding": "identity", "User-Agent": "REGAM-Academy-Release-Check/1.0"},
        )
        try:
            with self.opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                _, final_origin = https_origin(response.geturl())
                if final_origin != self.origin:
                    raise VerificationError("La réponse ne provient pas de l’origine attendue.")
                if response.status != 200:
                    raise VerificationError(f"Réponse HTTP inattendue pour {relative} : {response.status}.")
                if response.headers.get("Content-Encoding", "identity").strip().lower() not in ("", "identity"):
                    raise VerificationError(f"Réponse compressée inattendue pour {relative}.")
                length = response.headers.get("Content-Length")
                if length is not None:
                    if not re.fullmatch(r"[0-9]{1,20}", length.strip()):
                        raise VerificationError(f"Taille HTTP invalide pour {relative}.")
                    if int(length) > limit:
                        raise VerificationError(f"Le fichier {relative} dépasse la taille autorisée.")
                yield response
        except urllib.error.HTTPError as exc:
            raise VerificationError(f"Téléchargement impossible pour {relative} : HTTP {exc.code}.") from exc
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
            raise VerificationError(f"Erreur réseau, TLS ou délai dépassé pendant la lecture de {relative}.") from exc


class LocalSource:
    def __init__(self, directory):
        try:
            self.root = Path(directory).resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise VerificationError("Le dossier local est introuvable.") from exc
        if not self.root.is_dir():
            raise VerificationError("L’option --site doit désigner un dossier.")
        self.local = True

    @contextmanager
    def open(self, relative, limit):
        safe_relative_path(relative)
        try:
            target = (self.root / relative).resolve(strict=True)
            try:
                target.relative_to(self.root)
            except ValueError as exc:
                raise VerificationError("Un fichier local sort du dossier autorisé.") from exc
            if not target.is_file():
                raise VerificationError(f"Le chemin {relative} ne désigne pas un fichier.")
            if target.stat().st_size > limit:
                raise VerificationError(f"Le fichier {relative} dépasse la taille autorisée.")
            with target.open("rb") as stream:
                yield stream
        except (OSError, RuntimeError) as exc:
            raise VerificationError(f"Lecture locale impossible pour {relative}.") from exc


def digest_stream(source, relative, limit, retain=False):
    digest, size, chunks = hashlib.sha256(), 0, []
    with source.open(relative, limit) as stream:
        while True:
            chunk = stream.read(min(CHUNK_BYTES, limit - size + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise VerificationError(f"Le fichier {relative} dépasse la taille autorisée.")
            digest.update(chunk)
            if retain:
                chunks.append(chunk)
    return size, digest.hexdigest(), b"".join(chunks) if retain else None


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError("Le manifeste contient une clé JSON répétée.")
        result[key] = value
    return result


def reject_json_constant(_value):
    raise VerificationError("Le manifeste contient une valeur JSON non autorisée.")


def parse_manifest(raw):
    try:
        manifest = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=reject_json_constant)
    except (ValueError, RecursionError) as exc:
        raise VerificationError("Le manifeste n’est pas un document JSON UTF-8 valide.") from exc
    if not isinstance(manifest, dict):
        raise VerificationError("Le manifeste doit être un objet JSON.")
    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version) or len(version) > 64:
        raise VerificationError("Le manifeste ne contient pas de numéro de version valide.")
    files = manifest.get("files")
    if not isinstance(files, list) or not files or len(files) > MAX_FILES:
        raise VerificationError("La liste des fichiers du manifeste est absente ou trop longue.")
    paths = {}
    audio_count = 0
    for entry in files:
        if not isinstance(entry, dict):
            raise VerificationError("Une entrée de fichier du manifeste est invalide.")
        relative = safe_relative_path(entry.get("path"))
        canonical = relative.casefold()
        if canonical == MANIFEST_NAME or canonical in paths:
            raise VerificationError("Le manifeste contient un chemin répété ou en conflit.")
        paths[canonical] = entry
        if not valid_hash(entry.get("sha256")):
            raise VerificationError(f"Empreinte SHA-256 invalide pour {relative}.")
        size = entry.get("bytes")
        if type(size) is not int or not 1 <= size <= MAX_FILE_BYTES:
            raise VerificationError(f"Taille attendue invalide pour {relative}.")
        if entry.get("kind") not in ("page", "script", "audio-video"):
            raise VerificationError(f"Type de fichier invalide pour {relative}.")
        if entry["kind"] == "audio-video":
            if not relative.lower().endswith(".mp4") or not isinstance(entry.get("audio_codec"), str) or entry["audio_codec"].lower() != "aac":
                raise VerificationError(f"Métadonnées audio AAC absentes ou invalides pour {relative}.")
            audio_count += 1
    for canonical in paths:
        parts = canonical.split("/")
        if any("/".join(parts[:index]) in paths for index in range(1, len(parts))):
            raise VerificationError("Un chemin du manifeste entre en conflit avec un dossier.")
    for relative, kind in REQUIRED_FILES.items():
        entry = paths.get(relative)
        if entry is None or entry["path"] != relative or entry["kind"] != kind:
            raise VerificationError(f"Le manifeste doit inclure le fichier {relative} avec le bon type.")
    if not audio_count:
        raise VerificationError("Le manifeste ne contient aucune vidéo audio validée.")
    coverage = manifest.get("coverage")
    if not isinstance(coverage, dict):
        raise VerificationError("Le bilan des langues est absent du manifeste.")
    for key in ("native_per_language", "silent_per_language"):
        value = coverage.get(key)
        if type(value) is not int or not 0 <= value <= MAX_FILES:
            raise VerificationError("Le bilan des langues contient un nombre invalide.")
    return manifest, audio_count


def verify(source, expected_manifest, output=print):
    if not valid_hash(expected_manifest):
        raise VerificationError("L’empreinte attendue du manifeste doit contenir 64 caractères hexadécimaux.")
    _size, digest, raw = digest_stream(source, MANIFEST_NAME, MAX_MANIFEST_BYTES, retain=True)
    if digest != expected_manifest.lower():
        raise VerificationError("L’empreinte du manifeste ne correspond pas à la version attendue. Aucun fichier n’a été validé.")
    manifest, audio_count = parse_manifest(raw)
    output(f"Manifeste authentifié · REGAM Academy {manifest['version']}")
    files = manifest["files"]
    for index, entry in enumerate(files, 1):
        size, digest, _data = digest_stream(source, entry["path"], entry["bytes"])
        if size != entry["bytes"]:
            raise VerificationError(f"Taille incorrecte pour {entry['path']} : {size} octets reçus, {entry['bytes']} attendus.")
        if digest != entry["sha256"].lower():
            raise VerificationError(f"Empreinte incorrecte pour {entry['path']}.")
        output(f"OK {index:02d}/{len(files):02d} · {entry['path']}")
    coverage = manifest["coverage"]
    native, silent = coverage["native_per_language"], coverage["silent_per_language"]
    output(f"Couverture par langue · {native} {'vidéo' if native == 1 else 'vidéos'} avec voix, {silent} {'vidéo' if silent == 1 else 'vidéos'} sans voix.")
    location = "Fichiers locaux" if source.local else "Fichiers publiés en HTTPS"
    audio_label = "vidéo audio" if audio_count == 1 else "vidéos audio"
    output(f"SUCCÈS · {location} conformes : {len(files)} fichiers vérifiés, dont {audio_count} {audio_label}, version {manifest['version']}.")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description="Vérifier les fichiers Academy à partir d’un manifeste SHA-256 épinglé.")
    parser.add_argument("base_url", nargs="?", help="Adresse HTTPS racine du site publié.")
    parser.add_argument("--expected-manifest", required=True, help="SHA-256 exact du fichier release-audio.json validé.")
    parser.add_argument("--site", metavar="DOSSIER", help="Contrôle local de développement, sans accès réseau.")
    args = parser.parse_args(argv)
    if bool(args.base_url) == bool(args.site):
        parser.error("Indiquez soit une adresse HTTPS, soit --site DOSSIER.")
    try:
        if not valid_hash(args.expected_manifest):
            raise VerificationError("L’empreinte attendue doit contenir 64 caractères hexadécimaux.")
        source = LocalSource(args.site) if args.site else PublishedSource(args.base_url)
        verify(source, args.expected_manifest)
    except VerificationError as exc:
        print(f"ÉCHEC · {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Vérification interrompue. La conformité de l’ensemble des fichiers n’est pas confirmée.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
