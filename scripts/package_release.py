#!/usr/bin/env python3
"""Package the deployable site and editable sources, excluding build caches.

Run from any directory: python3 scripts/package_release.py
Outputs dist/REGAM_Academy_Bac_Maths_v1.zip and its SHA-256 digest.
"""
from pathlib import Path
import hashlib
import json
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOP = {'README.md', '.gitignore', 'install.sh', 'package.json', 'package-lock.json'}
DIRS = {'content', 'docs', 'scripts', 'site', 'tests', 'tools'}
EXCLUDED = {'__pycache__', 'node_modules', '.git', 'video_build', 'publish_build', 'dist'}


def sources():
    for path in sorted(ROOT.rglob('*')):
        rel = path.relative_to(ROOT)
        if not path.is_file() or any(part in EXCLUDED for part in rel.parts):
            continue
        if path.is_symlink():
            raise ValueError(f'Symlink excluded from release: {rel}')
        if rel.parts[0] in DIRS or (len(rel.parts) == 1 and rel.name in TOP):
            yield path


def main():
    files = list(sources())
    checksums = ''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(ROOT).as_posix()}\n' for p in files)
    manifest = ROOT / 'SHA256SUMS.txt'
    manifest.write_text(checksums, encoding='utf-8')
    files.append(manifest)
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    archive = dist / 'REGAM_Academy_Bac_Maths_v1.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in files:
            info = zipfile.ZipInfo('regam-bac-maths/' + path.relative_to(ROOT).as_posix(), (2026, 11, 20, 0, 0, 0))
            info.create_system = 3
            mode = 0o755 if path.name == 'install.sh' else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes())
    with zipfile.ZipFile(archive) as zf:
        if zf.testzip() is not None:
            raise RuntimeError('ZIP checksum validation failed')
        assert len(zf.infolist()) == len(files)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (dist / 'REGAM_Academy_Bac_Maths_v1.sha256').write_text(f'{digest}  {archive.name}\n')
    print(json.dumps({'archive': str(archive), 'files': len(files), 'bytes': archive.stat().st_size, 'sha256': digest}))


if __name__ == '__main__':
    main()
