"""Short, offline checks for the pinned release verifier and its trust boundary."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.request


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_published.py"
SPEC = importlib.util.spec_from_file_location("verify_published", SCRIPT)
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


class PublishedVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = Path(self.temp.name)
        files = {
            "index.html": (b"<title>REGAM Academy</title>\n", "page"),
            "assets/app.js": (b"/* app fixture */\n", "script"),
            "assets/i18n.js": (b"/* translations fixture */\n", "script"),
            "assets/style.css": (b"body { color: navy; }\n", "script"),
            "data/courses.js": (b"/* courses fixture */\n", "script"),
            # These are arbitrary fixture bytes. The release verifier checks
            # integrity, while the release build owns actual media validation.
            "media/fr/example.mp4": (b"validated-media-fixture" * 10000, "audio-video"),
        }
        entries = []
        for relative, (content, kind) in files.items():
            destination = self.site / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            entry = {"path": relative, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "kind": kind}
            if kind == "audio-video":
                entry["audio_codec"] = "aac"
            entries.append(entry)
        self.manifest = {"version": "1.3.0", "files": entries, "coverage": {"native_per_language": 1, "silent_per_language": 0}}
        self.pin = self.write_manifest(self.manifest)

    def write_manifest(self, manifest):
        raw = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        (self.site / verifier.MANIFEST_NAME).write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def run_cli(self, pin=None):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--site", str(self.site), "--expected-manifest", pin or self.pin],
            capture_output=True, text=True, timeout=10,
        )

    def test_valid_pinned_manifest_and_streamed_files(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Manifeste authentifié", result.stdout)
        self.assertIn("OK 06/06", result.stdout)
        self.assertIn("SUCCÈS · Fichiers locaux conformes", result.stdout)
        self.assertIn("6 fichiers vérifiés, dont 1 vidéo audio", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_changed_file_and_changed_manifest_fail_without_success(self):
        app = self.site / "assets/app.js"
        original = app.read_bytes()
        app.write_bytes(b"X" * len(original))
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Empreinte incorrecte pour assets/app.js", result.stderr)
        self.assertNotIn("SUCCÈS", result.stdout)
        app.write_bytes(original)

        # A valid JSON document with different bytes must fail the manifest pin
        # before any listed content can be accepted.
        manifest_file = self.site / verifier.MANIFEST_NAME
        manifest_file.write_bytes(manifest_file.read_bytes() + b" ")
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("L’empreinte du manifeste", result.stderr)
        self.assertNotIn("Manifeste authentifié", result.stdout)
        self.assertNotIn("SUCCÈS", result.stdout)

    def test_unsafe_paths_collisions_and_redirects_are_rejected(self):
        for relative in ("../outside.mp4", "/outside.mp4", "media/%2e%2e/outside.mp4", "media\\outside.mp4"):
            with self.subTest(path=relative):
                manifest = copy.deepcopy(self.manifest)
                manifest["files"][-1]["path"] = relative
                with self.assertRaises(verifier.VerificationError):
                    verifier.parse_manifest(json.dumps(manifest).encode("utf-8"))
        for collision in ("assets/App.js", "assets"):
            with self.subTest(collision=collision):
                manifest = copy.deepcopy(self.manifest)
                entry = dict(manifest["files"][1], path=collision)
                manifest["files"].append(entry)
                with self.assertRaises(verifier.VerificationError):
                    verifier.parse_manifest(json.dumps(manifest).encode("utf-8"))
        malformed = copy.deepcopy(self.manifest)
        malformed["files"][-1]["bytes"] = True
        with self.assertRaises(verifier.VerificationError):
            verifier.parse_manifest(json.dumps(malformed).encode("utf-8"))

        # A pinned manifest never permits a redirect to send subsequent file
        # requests to another origin or to downgrade HTTPS.
        guard = verifier.SameOriginRedirects(("https", "academy.invalid", 443))
        request = urllib.request.Request("https://academy.invalid/release-audio.json")
        for destination in ("https://elsewhere.invalid/file", "http://academy.invalid/file", "https://academy.invalid:8443/file"):
            with self.subTest(redirect=destination):
                with self.assertRaises(verifier.VerificationError):
                    guard.redirect_request(request, None, 302, "Found", {}, destination)
        allowed = guard.redirect_request(request, None, 302, "Found", {}, "https://academy.invalid:443/release/version.json")
        self.assertEqual(allowed.full_url, "https://academy.invalid:443/release/version.json")


if __name__ == "__main__":
    unittest.main()
