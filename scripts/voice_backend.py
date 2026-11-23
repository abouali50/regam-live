#!/usr/bin/env python3
"""Create real, resumable scene narration without API keys or paid API calls.

Build dependency: ``python -m pip install edge-tts==7.3.1`` plus FFmpeg.
The documented edge-tts client uses Microsoft Edge's online speech service.
It requires network access and offers no service availability guarantee.
TLS validation stays enabled; operating-system trust roots are added to the
client's normal CA bundle for environments with a managed outbound proxy.

``generate_scenes(lang, lesson_id, script_lines)`` returns a manifest.  Its
scene ``path`` values are absolute local paths, while ``relative_path`` values
are repository-relative. MP3 scene caches live in ignored ``video_build``;
only the small complete manifest is persisted in ``content/narration``.
The caller must distribute the rendered final MP4s, not this build cache.

Text is sent to the online speech service. Use this for authored public lesson
scripts, not confidential material. No automatic fallback changes the voice.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
VOICES = {
    "ar": {"id": "ar-SA-ZariyahNeural", "name": "Zariyah", "locale": "ar-SA", "gender": "female"},
    "fr": {"id": "fr-FR-DeniseNeural", "name": "Denise", "locale": "fr-FR", "gender": "female"},
    "en": {"id": "en-GB-SoniaNeural", "name": "Sonia", "locale": "en-GB", "gender": "female"},
}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
        pending = Path(handle.name)
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    try:
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def _spoken_text(line: Any) -> str:
    if isinstance(line, str):
        text = line
    elif isinstance(line, dict):
        text = next((line[key] for key in ("speech", "narration", "spokenText", "text")
                     if isinstance(line.get(key), str) and line[key].strip()), "")
    else:
        raise ValueError("Each scene must be a string or an object containing speech/text.")
    text = text.strip()
    if not text or len(text) > 25000:
        raise ValueError("Each scene needs between 1 and 25,000 characters of spoken text.")
    if "\x00" in text:
        raise ValueError("Narration text contains a NUL character.")
    return text


def _chunks(text: str, maximum: int = 1600) -> list[str]:
    """Split only at whitespace, keeping a bound per speech request."""
    chunks, current = [], ""
    for word in text.split():
        if len(word) > maximum:
            raise ValueError("Narration has an unexpectedly long word/token.")
        candidate = (current + " " + word).strip()
        if len(candidate) > maximum and current:
            chunks.append(current)
            current = word
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _inspect_audio(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size < 100:
        raise ValueError("Speech synthesis returned no usable audio bytes.")
    probe = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        text=True, timeout=30))
    audio = [stream for stream in probe["streams"] if stream.get("codec_type") == "audio"]
    if len(audio) != 1:
        raise ValueError("Expected exactly one audio stream.")
    duration = float(probe["format"]["duration"])
    if not math.isfinite(duration) or not 0.15 <= duration <= 2400:
        raise ValueError(f"Invalid speech duration: {duration}")
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path), "-map", "0:a:0",
         "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True, check=True, timeout=60)
    values = {}
    for label in ("mean_volume", "max_volume"):
        found = re.search(label + r":\s*(-?[\d.]+|[-+]?inf) dB", result.stderr)
        if not found:
            raise ValueError("Could not verify the generated audio signal.")
        values[label + "_db"] = float(found.group(1))
    if not all(math.isfinite(value) for value in values.values()) or values["max_volume_db"] < -55:
        raise ValueError("Generated audio is silent or too quiet to count as narration.")
    return {"duration": duration, "durationSeconds": duration,
            "audio_sha256": _sha(path.read_bytes()), "audio_codec": audio[0]["codec_name"],
            "sample_rate": int(audio[0]["sample_rate"]),
            "channels": int(audio[0]["channels"]), **values}


async def _edge_request(text: str, voice: str, rate: str, destination: Path,
                        timeout: float) -> None:
    try:
        import edge_tts
        import edge_tts.communicate
    except ImportError as exc:
        raise RuntimeError("Install the build dependency: python -m pip install edge-tts==7.3.1") from exc
    # Add the OS's trusted roots; never disable certificate or hostname checks.
    edge_tts.communicate._SSL_CTX.load_default_certs()
    task = edge_tts.Communicate(text=text, voice=voice, rate=rate,
                                volume="+0%", pitch="+0Hz")
    await asyncio.wait_for(task.save(str(destination)), timeout=timeout)


def _generate_chunk(text: str, voice: str, rate: str, destination: Path,
                    timeout: float, attempts: int) -> None:
    last_error: Exception | None = None
    for attempt in range(attempts):
        destination.unlink(missing_ok=True)
        try:
            asyncio.run(_edge_request(text, voice, rate, destination, timeout))
            _inspect_audio(destination)
            return
        except Exception as exc:
            destination.unlink(missing_ok=True)
            # Authentication/access refusal is not a transient synthesis failure.
            if getattr(exc, "status", None) in (401, 403):
                raise RuntimeError("Speech service refused access; no bypass or voice fallback attempted.") from exc
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(f"Speech synthesis failed after {attempts} attempts: {last_error}") from last_error


def generate_scenes(lang: str, lesson_id: str, script_lines: Iterable[Any], *,
                    backend: str = "edge", model_dir: str | Path | None = None,
                    rate: str = "-5%", timeout: float = 90,
                    attempts: int = 3, allow_online: bool = False) -> dict[str, Any]:
    """Synthesize/reuse all scenes, validating real non-silent audio before return.

    Raises on any failed scene; a complete new manifest is never published on
    partial success. Intermediate valid scene files are reusable on a retry.
    ``model_dir`` is accepted for API compatibility but unused by online Edge.
    """
    if backend != "edge":
        raise ValueError("Only the tested 'edge' backend is available; no silent fallback.")
    if lang not in VOICES or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,95}", lesson_id):
        raise ValueError("Invalid language or lesson identifier.")
    if not re.fullmatch(r"[+-]\d+%", rate) or not 0 < timeout <= 600 or not 1 <= attempts <= 5:
        raise ValueError("Invalid synthesis options.")
    for command in ("ffmpeg", "ffprobe"):
        if not shutil.which(command):
            raise RuntimeError(f"Required build command is missing: {command}")
    try:
        version = importlib.metadata.version("edge-tts")
    except importlib.metadata.PackageNotFoundError as exc:
        raise RuntimeError("Install the build dependency: python -m pip install edge-tts==7.3.1") from exc
    if isinstance(script_lines, (str, bytes, dict)):
        raise ValueError("script_lines must be an iterable of scenes, not one string or object.")
    lines = [_spoken_text(line) for line in script_lines]
    if not lines:
        raise ValueError("No narration scenes were supplied.")
    voice = {**VOICES[lang], "type": "synthetic", "provider": "Microsoft Edge online speech",
             "engine": "edge-tts", "engine_version": version, "rate": rate, "pitch": "+0Hz"}
    directory = ROOT / "video_build" / "audio" / lesson_id / lang
    directory.mkdir(parents=True, exist_ok=True)
    scenes = []
    for index, text in enumerate(lines):
        identity = {"provider": "edge", "voice": voice["id"], "rate": rate,
                    "pitch": "+0Hz", "engine_version": version, "text": text}
        key = _sha(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode())
        destination = directory / f"{index + 1:02d}-{key[:16]}.mp3"
        sidecar = destination.with_suffix(".json")
        info = None
        if destination.exists() and sidecar.exists():
            try:
                prior = json.loads(sidecar.read_text())
                if prior.get("cache_key") == key and prior.get("audio_sha256") == _sha(destination.read_bytes()):
                    info = _inspect_audio(destination)
            except (ValueError, KeyError, OSError, subprocess.SubprocessError):
                info = None
        if info is None:
            if not allow_online:
                raise PermissionError(
                    "Online narration is paused. Obtain the user's explicit approval to send "
                    "these lesson scripts to Microsoft Edge's speech service, then pass allow_online=True."
                )
            with tempfile.TemporaryDirectory(prefix="voice-", dir=directory) as temporary:
                work = Path(temporary)
                pieces = []
                for part_index, chunk in enumerate(_chunks(text)):
                    part = work / f"{part_index:03d}.mp3"
                    _generate_chunk(chunk, voice["id"], rate, part, timeout, attempts)
                    pieces.append(part)
                pending = work / "complete.mp3"
                if len(pieces) == 1:
                    os.replace(pieces[0], pending)
                else:
                    concat = work / "parts.txt"
                    concat.write_text("".join(f"file '{part.name}'\n" for part in pieces))
                    subprocess.run(["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
                                    "-f", "concat", "-safe", "1", "-i", str(concat),
                                    "-c:a", "libmp3lame", "-b:a", "128k", str(pending)],
                                   check=True, timeout=120)
                info = _inspect_audio(pending)
                os.replace(pending, destination)
            _json_write(sidecar, {"cache_key": key, **identity, **info})
        scene = {"index": index, "text": text, "text_sha256": _sha(text.encode()),
                 "submitted_chunks": _chunks(text),
                 "path": str(destination), "relative_path": destination.relative_to(ROOT).as_posix(),
                 "cache_key": key, **info}
        scenes.append(scene)
        print(f"VOICE OK {lang} {lesson_id} {index + 1}/{len(lines)} {info['duration']:.2f}s", flush=True)
    manifest_path = ROOT / "content" / "narration" / lesson_id / lang / "manifest.json"
    manifest = {"schema_version": 1, "complete": True, "provider": "edge", "voice": voice,
                "language": lang, "lesson": lesson_id,
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "script_sha256": _sha(json.dumps(lines, ensure_ascii=False).encode()),
                "total_duration": sum(scene["duration"] for scene in scenes),
                "listening_review": "Not independently listened to; audio signal and decoding verified.",
                "source": "https://github.com/rany2/edge-tts", "scenes": scenes}
    # Durable manifests use portable repository-relative paths only.
    portable = {**manifest, "scenes": [{**scene, "path": scene["relative_path"]} for scene in scenes]}
    _json_write(manifest_path, portable)
    manifest["manifest_path"] = str(manifest_path)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lang", required=True, choices=tuple(VOICES))
    parser.add_argument("--lesson", required=True)
    parser.add_argument("--scripts", type=Path, required=True,
                        help="JSON list of scene strings or objects with speech/text keys")
    parser.add_argument("--backend", choices=("edge",), default="edge")
    parser.add_argument("--rate", default="-5%")
    parser.add_argument("--allow-online-voice", action="store_true",
                        help="Only after explicit user approval to send lesson text to Microsoft's speech service")
    args = parser.parse_args()
    lines = json.loads(args.scripts.read_text(encoding="utf-8"))
    if isinstance(lines, dict):
        lines = lines.get(args.lang, lines.get("scenes", lines.get("segments")))
    if not isinstance(lines, list):
        parser.error("--scripts must resolve to a JSON list of scenes")
    result = generate_scenes(args.lang, args.lesson, lines, backend=args.backend, rate=args.rate, allow_online=args.allow_online_voice)
    print(json.dumps({"manifest_path": result["manifest_path"], "scenes": len(result["scenes"]),
                      "duration": result["total_duration"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
