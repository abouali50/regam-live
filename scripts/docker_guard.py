#!/usr/bin/env python3
"""Validate the explicitly supported REGAM Live Docker layout and prepare its block.

Inputs contain selected inspect fields only. Container environment variables are
never requested. The write command deliberately replaces bytes in an existing
file without replacing its inode. No Docker, network or service operation occurs.
"""
import fnmatch
import json
import os
from pathlib import Path
import re
import sys

OWNER = 'REGAM_BAC_MATHS_V1'
BEGIN = '# BEGIN REGAM_BAC_MATHS_V1'
END = '# END REGAM_BAC_MATHS_V1'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load(path):
    return json.loads(Path(path).read_text())


def image_id(value):
    return bool(re.fullmatch(r'sha256:[a-f0-9]{64}', value or ''))


def container_id(value):
    return bool(re.fullmatch(r'[a-f0-9]{64}', value or ''))


def check_live(data, expected_file):
    require(container_id(data.get('id')) and data.get('running') is True,
            'Le conteneur Caddy REGAM Live doit être actif.')
    require(data.get('project') == 'regam-live' and data.get('service') == 'caddy',
            'Les labels Compose ne désignent pas le Caddy de REGAM Live.')
    require(data.get('path') == 'caddy' and data.get('args') ==
            ['run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
            'La commande Caddy est personnalisée (watch, resume ou autre configuration).')
    require(image_id(data.get('image')), 'Image Docker Caddy non identifiée par son SHA.')
    mounts = [m for m in data.get('mounts', []) if m.get('Destination') == '/etc/caddy/Caddyfile']
    require(len(mounts) == 1 and mounts[0].get('Type') == 'bind'
            and mounts[0].get('Source') == expected_file and mounts[0].get('RW') is False,
            'Le Caddyfile doit être le bind mount en lecture seule de REGAM Live.')
    networks = data.get('networks') or {}
    require(len(networks) == 1, 'Le Caddy Docker doit utiliser un unique réseau dédié.')
    network = next(iter(networks))
    network_id = networks[network].get('NetworkID', '')
    require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', network)
            and network not in {'host', 'none', 'bridge'} and container_id(network_id),
            'Le réseau Docker de Caddy n’est pas un réseau Compose identifié.')
    require(data.get('network_mode') in {network, network_id}, 'Mode réseau Docker inhabituel.')
    ports = data.get('ports') or {}
    for port in ('80', '443'):
        bindings = ports.get(port + '/tcp') or []
        require(any(b.get('HostPort') == port and b.get('HostIp') in {'', '0.0.0.0'} for b in bindings),
                'Caddy doit publier TCP 80 et 443 sur toutes les adresses IPv4 du VPS.')
    for key, bindings in ports.items():
        for binding in bindings or []:
            require(key in {'80/tcp', '443/tcp'} and binding.get('HostPort') == key.split('/')[0]
                    and binding.get('HostIp') in {'', '0.0.0.0', '::'},
                    'Publication de ports Caddy différente du mode direct REGAM Live.')
    return data['image'], network, network_id


def check_network(data, name, network_id):
    require(data.get('id') == network_id and data.get('name') == name
            and data.get('driver') == 'bridge' and data.get('scope') == 'local'
            and data.get('internal') is False and data.get('ingress') is False
            and data.get('project') == 'regam-live',
            'Le réseau doit être un bridge local de REGAM Live, accessible au proxy.')


def check_port_owners(records, expected_id, side_id=''):
    require(any(r.get('id') == expected_id for r in records), 'Le Caddy attendu n’est plus actif.')
    for record in records:
        for bindings in (record.get('ports') or {}).values():
            for binding in bindings or []:
                if binding.get('HostPort') in {'80', '443'}:
                    require(record.get('id') == expected_id,
                            'Un autre conteneur publie le port 80 ou 443. Aucun changement effectué.')
        if record.get('id') != side_id:
            for endpoint in (record.get('networks') or {}).values():
                require('regam-bac-maths' not in (endpoint.get('Aliases') or []),
                        'L’alias réseau regam-bac-maths est déjà utilisé par un autre conteneur.')


def check_side(data, deploy_base, network, network_id, state):
    require(data.get('owner') == OWNER and not data.get('project'),
            'Le nom regam-bac-maths existe sans appartenance vérifiable à cet installateur.')
    require(state.get('server') == 'caddy-docker'
            and data.get('id') == state.get('static_container_id')
            and data.get('image') == state.get('static_image') and image_id(data.get('image')),
            'Le conteneur statique ne correspond pas à l’état enregistré. Vérification manuelle requise.')
    require(data.get('running') is True, 'Le conteneur statique existant est arrêté. Rétablissez-le avant la mise à jour.')
    mounts = data.get('mounts') or []
    binds = [m for m in mounts if m.get('Type') == 'bind']
    require(len(binds) == 1 and binds[0].get('Source') == deploy_base
            and binds[0].get('Destination') == '/srv' and binds[0].get('RW') is False
            and all(m in binds or (m.get('Type') == 'tmpfs' and m.get('Destination') in {'/tmp', '/config', '/data'}) for m in mounts),
            'Montage du conteneur statique non conforme.')
    networks = data.get('networks') or {}
    require(set(networks) == {network} and networks[network].get('NetworkID') == network_id
            and data.get('network_mode') in {network, network_id},
            'Le conteneur statique n’est plus sur le réseau REGAM Live attendu.')
    require(not data.get('port_bindings') and not any((data.get('ports') or {}).values()),
            'Le conteneur statique ne doit publier aucun port hôte.')
    require(data.get('entrypoint') == ['caddy'] and data.get('cmd') ==
            ['file-server', '--root', '/srv/current', '--listen', ':8080']
            and data.get('user') == '65534:65534', 'Commande ou utilisateur du serveur statique non conforme.')
    require(data.get('privileged') is False and data.get('readonly') is True
            and not data.get('cap_add') and 'ALL' in (data.get('cap_drop') or [])
            and any(x in {'no-new-privileges', 'no-new-privileges:true'} for x in (data.get('security_opt') or []))
            and data.get('restart') == 'unless-stopped', 'Protections du serveur statique non conformes.')
    tmpfs = data.get('tmpfs') or {}
    require(set(tmpfs) == {'/tmp', '/config', '/data'}, 'Les répertoires temporaires privés sont manquants.')
    for options in tmpfs.values():
        tokens = set(options.split(','))
        require({'uid=65534', 'gid=65534', 'nosuid', 'nodev', 'noexec'} <= tokens
                and bool({'mode=0700', 'mode=700'} & tokens),
                'Options des répertoires temporaires privés non conformes.')


def split_block(text):
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.rstrip('\r\n') == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.rstrip('\r\n') == END]
    require(len(starts) == len(ends) and len(starts) <= 1
            and (not starts or starts[0] < ends[0]), 'Bloc REGAM du Caddyfile ambigu ou incomplet.')
    if not starts:
        return text, ''
    start, end = starts[0], ends[0]
    return ''.join(lines[:start] + lines[end + 1:]), ''.join(lines[start:end + 1])


def check_owned_block(path, state_path, domain):
    base, block = split_block(Path(path).read_text())
    if block:
        require(Path(state_path).is_file(), 'Un bloc Academy existe sans état d’installation enregistré.')
        state = load(state_path)
        require(state.get('server') == 'caddy-docker' and state.get('domain') == domain
                and len(re.findall(r'(?m)^' + re.escape(domain) + r'\s*\{', block)) == 1,
                'Le bloc Academy appartient à un autre domaine ou à un état non reconnu.')
    return base, block


def draft(main, output, domain, email, side, state_path):
    base, _ = check_owned_block(main, state_path, domain)
    block = f'''{BEGIN}
{domain} {{
    tls {email}
    encode zstd gzip
    header X-Content-Type-Options nosniff
    header Referrer-Policy strict-origin-when-cross-origin
    @health path /regam-health.txt
    header @health Cache-Control "no-store"
    @index path / /index.html
    header @index Cache-Control "no-cache"
    reverse_proxy {side}:8080
}}
{END}
'''
    Path(output).write_text(base + ('' if base.endswith('\n') else '\n') + '\n' + block)


def collision(adapted, domain, main, state_path):
    _, block = check_owned_block(main, state_path, domain)
    matches = []
    def walk(value):
        if isinstance(value, dict):
            for host in value.get('host', []):
                if isinstance(host, str) and fnmatch.fnmatchcase(domain, host.lower()):
                    matches.append(host)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(load(adapted))
    require(not matches or (bool(block) and matches == [domain]),
            'Ce domaine correspond déjà à un hôte Caddy existant. Choisissez un nouveau sous-domaine.')


def write_in_place(source, destination):
    path = Path(destination)
    require(path.is_file() and not path.is_symlink(), 'Le Caddyfile lié doit être un fichier normal existant.')
    content = Path(source).read_bytes()
    before = path.stat()
    fd = os.open(path, os.O_WRONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        require((before.st_dev, before.st_ino) == (opened.st_dev, opened.st_ino),
                'Le Caddyfile a changé pendant la préparation.')
        os.ftruncate(fd, 0)
        with os.fdopen(fd, 'wb', closefd=False) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(fd)


def main():
    action, *args = sys.argv[1:]
    if action == 'live':
        print('\n'.join(check_live(load(args[0]), args[1])))
    elif action == 'network':
        check_network(load(args[0]), *args[1:])
    elif action == 'ports':
        check_port_owners([json.loads(line) for line in Path(args[0]).read_text().splitlines() if line], *args[1:])
    elif action == 'side':
        check_side(load(args[0]), *args[1:4], load(args[4]))
    elif action == 'block':
        check_owned_block(*args)
    elif action == 'draft':
        draft(*args)
    elif action == 'collision':
        collision(*args)
    elif action == 'write':
        write_in_place(*args)
    else:
        raise ValueError('Commande de validation inconnue.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        sys.exit('ERREUR: ' + str(error))
