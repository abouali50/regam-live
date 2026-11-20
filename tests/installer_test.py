"""Installer checks, all mutations are confined to Python temporary directories.

Run: python3 -m unittest discover -s tests -p 'installer_test.py' -v
No package installation, service operation, root install or network request.
"""
import os
import copy
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

INSTALLER = Path(__file__).resolve().parents[1] / 'install.sh'
spec = importlib.util.spec_from_file_location('docker_guard', INSTALLER.parent / 'scripts/docker_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

def live_fixture(source='/opt/regam-live/deploy/Caddyfile'):
    return dict(id='a'*64, image='sha256:'+'b'*64, running=True,
                project='regam-live', service='caddy', path='caddy',
                args=['run','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],
                mounts=[dict(Type='bind',Source=source,Destination='/etc/caddy/Caddyfile',RW=False)],
                ports={'80/tcp':[dict(HostPort='80',HostIp='0.0.0.0')],
                       '443/tcp':[dict(HostPort='443',HostIp='0.0.0.0')]},
                networks={'regam-live_default':dict(NetworkID='c'*64,Aliases=['caddy'])},
                network_mode='regam-live_default')

def side_fixture(base='/var/www/regam-bac-maths'):
    return dict(id='d'*64,image='sha256:'+'b'*64,running=True,owner=guard.OWNER,project='',
                mounts=[dict(Type='bind',Source=base,Destination='/srv',RW=False)],
                networks={'regam-live_default':dict(NetworkID='c'*64,Aliases=['regam-bac-maths'])},
                network_mode='regam-live_default',ports={},port_bindings={},
                entrypoint=['caddy'],cmd=['file-server','--root','/srv/current','--listen',':8080'],
                user='65534:65534',privileged=False,readonly=True,cap_add=[],cap_drop=['ALL'],
                security_opt=['no-new-privileges:true'],restart='unless-stopped',
                tmpfs={p:'rw,nosuid,nodev,noexec,uid=65534,gid=65534,mode=0700,size=16m' for p in ['/tmp','/config','/data']})

class InstallerTests(unittest.TestCase):
    def run_bash(self, code, input_text=None, **values):
        env = os.environ.copy()
        env.update(INSTALLER=str(INSTALLER), **{k:str(v) for k,v in values.items()})
        return subprocess.run(['bash','-c','source "$INSTALLER"\n'+code],env=env,capture_output=True,text=True,input=input_text)

    def test_shell_syntax(self):
        p=subprocess.run(['bash','-n',str(INSTALLER)],capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stderr)

    def test_valid_domain(self):
        for value in ['maths.ecole.ma','bac-2026.regam.online','xn--cole-9oa.ma']:
            with self.subTest(value=value):
                p=self.run_bash('validate_domain "$VALUE"',VALUE=value)
                self.assertEqual(p.returncode,0,p.stderr)

    def test_rejects_console_urls_ips_and_injection(self):
        for value in ['https://maths.ecole.ma','bos.hostingervps.com','hpanel.hostinger.com','127.0.0.1',
                      'maths.ecole.ma:443','-bad.ecole.ma','maths..ecole.ma','maths.ecole.ma/x','*.ecole.ma',
                      'maths.ecole.ma\nother.ma','maths.ecole.ma;touch /tmp/nope','example.com','foo.local']:
            with self.subTest(value=value):
                p=self.run_bash('if validate_domain "$VALUE"; then exit 0; else exit 7;fi',VALUE=value)
                self.assertEqual(p.returncode,7,p.stdout+p.stderr)

    def test_email_validation(self):
        for value,valid in [('prof+bac@ecole.ma',True),('prof@ecole.ma',True),
                            ('prof@ecole',False),('a@b.ma;id',False),('a\nb@ecole.ma',False),('a@b..ma',False)]:
            with self.subTest(value=value):
                p=self.run_bash('if validate_email "$VALUE";then exit 0;else exit 7;fi',VALUE=value)
                self.assertEqual(p.returncode,0 if valid else 7,p.stderr)

    def test_guided_input_rejects_console_and_invalid_email_then_accepts(self):
        p=self.run_bash('prompt_install_details\nprintf "RESULT=%s|%s\\n" "$DOMAIN" "$EMAIL"',
                        input_text='bos.hostingervps.com\nMaths.Ecole.ma\nwrong\nprof@ecole.ma\n')
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('Domaine invalide',p.stderr)
        self.assertIn('Adresse email invalide',p.stderr)
        self.assertIn('RESULT=maths.ecole.ma|prof@ecole.ma',p.stdout)

    def test_guided_input_eof_fails_before_installation(self):
        p=self.run_bash('prompt_install_details\nprintf "UNEXPECTED INSTALLATION\\n"',input_text='')
        self.assertNotEqual(p.returncode,0)
        self.assertIn('Saisie interrompue',p.stderr)
        self.assertNotIn('UNEXPECTED INSTALLATION',p.stdout)

    def test_dangling_deployment_directory_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t)/'app';base.symlink_to(Path(t)/'missing')
            p=self.run_bash('STATE_DIR="$TEMP/state"\nDEPLOY_BASE="$BASE"\ncheck_managed_paths',TEMP=t,BASE=base)
            self.assertNotEqual(p.returncode,0)
            self.assertIn("n'appartient pas",p.stderr)

    def test_check_is_local_and_read_only(self):
        with tempfile.TemporaryDirectory() as t:
            site=Path(t)/'site';(site/'assets').mkdir(parents=True);(site/'data').mkdir()
            (site/'index.html').write_text('<title>REGAM Academy</title>')
            for name in ['assets/app.js','assets/style.css','data/courses.js']:(site/name).write_text('test')
            before={p.relative_to(site):p.read_bytes() for p in site.rglob('*') if p.is_file()}
            p=self.run_bash('SITE_DIR="$TEST_SITE"\nmain --check',TEST_SITE=site)
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertIn('CHECK OK',p.stdout)
            self.assertNotIn('DONE',p.stdout)
            self.assertEqual(before,{p.relative_to(site):p.read_bytes() for p in site.rglob('*') if p.is_file()})

    def test_site_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            site=Path(t)/'site';(site/'assets').mkdir(parents=True);(site/'data').mkdir()
            (site/'index.html').write_text('REGAM')
            for name in ['assets/app.js','assets/style.css','data/courses.js']:(site/name).write_text('test')
            (site/'escape').symlink_to('/etc')
            p=self.run_bash('SITE_DIR="$TEST_SITE"\nvalidate_sources',TEST_SITE=site)
            self.assertNotEqual(p.returncode,0)
            self.assertIn('lien symbolique',p.stderr)

    def test_unknown_listener_is_not_stopped(self):
        p=self.run_bash('''
running(){ return 1; }
ss(){ printf '%s\n' 'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:* users:(("docker-proxy",pid=123,fd=4))'; }
systemctl(){ printf 'UNEXPECTED MUTATION\n';return 99; }
detect_server
''')
        self.assertNotEqual(p.returncode,0)
        self.assertIn('autre processus ou un conteneur',p.stderr)
        self.assertNotIn('UNEXPECTED MUTATION',p.stdout)

    def test_two_active_servers_are_refused(self):
        p=self.run_bash('''
running(){ [[ "$1" == caddy || "$1" == nginx ]]; }
detect_server
''')
        self.assertNotEqual(p.returncode,0)
        self.assertIn('Caddy et Nginx',p.stderr)

    def test_atomic_current_rejects_escape(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t)/'app';(base/'releases'/'one').mkdir(parents=True);(Path(t)/'private').mkdir()
            p=self.run_bash('DEPLOY_BASE="$BASE"\natomic_current "$TARGET"',BASE=base,TARGET=base/'releases'/'one')
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertEqual((base/'current').resolve(),base/'releases'/'one')
            self.assertEqual(os.readlink(base/'current'),'releases/one')
            p=self.run_bash('DEPLOY_BASE="$BASE"\natomic_current "$TARGET"',BASE=base,TARGET=str(base/'releases')+'/../../private')
            self.assertNotEqual(p.returncode,0)
            self.assertEqual((base/'current').resolve(),base/'releases'/'one')

    def test_atomic_write_preserves_private_mode(self):
        with tempfile.TemporaryDirectory() as t:
            src=Path(t)/'source';dest=Path(t)/'target'
            src.write_text('new');dest.write_text('private config');dest.chmod(0o600)
            p=self.run_bash('write_atomic "$SRC" "$DEST"',SRC=src,DEST=dest)
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertEqual(dest.read_text(),'new')
            self.assertEqual(stat.S_IMODE(dest.stat().st_mode),0o600)

    def test_caddy_existing_sites_are_preserved(self):
        with tempfile.TemporaryDirectory() as t:
            pth=Path(t);main=pth/'Caddyfile';work=pth/'work';work.mkdir()
            original='existing.ecole.ma {\n reverse_proxy localhost:8080\n}\n'
            main.write_text(original)
            p=self.run_bash('''
CADDY_MAIN="$MAIN";CADDY_SITE="$SNIPPET";WORK_DIR="$WORK"
DOMAIN=maths.ecole.ma;EMAIL=prof@ecole.ma;DEPLOY_BASE="$BASE"
IMPORT_LINE="import $SNIPPET"
reload_server(){ return 0; }
configure_caddy
configure_caddy
''',MAIN=main,SNIPPET=pth/'site.caddy',WORK=work,BASE=pth/'app')
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertTrue(main.read_text().startswith(original))
            self.assertEqual(main.read_text().count('REGAM_BAC_MATHS_IMPORT_V1'),1)
            self.assertIn('maths.ecole.ma {',(pth/'site.caddy').read_text())

    def test_failure_restores_previous_release_and_config(self):
        with tempfile.TemporaryDirectory() as t:
            pth=Path(t);base=pth/'app';old=base/'releases'/'old';new=base/'releases'/'new'
            old.mkdir(parents=True);new.mkdir();(base/'current').symlink_to(new)
            backup=pth/'backup';backup.mkdir();(backup/'nginx.conf').write_text('previous config')
            (backup/'renewal-hook.sh.absent').touch()
            dest=pth/'site.conf';dest.write_text('new config')
            # Keep the hook snapshot absent out of this test: restore_file is
            # overridden to restore only the fixture destination, never /etc.
            p=self.run_bash('''
DEPLOY_BASE="$BASE";PREVIOUS="$OLD";CURRENT_CHANGED=1;CONFIG_CHANGED=1
SERVER=nginx;BACKUP_DIR="$BACKUP";NGINX_SITE="$DEST";WORK_DIR="$WORK"
restore_file(){ if [[ "$2" == nginx.conf ]];then cp "$BACKUP_DIR/nginx.conf" "$NGINX_SITE";fi; }
reload_server(){ return 0; }
trap on_exit EXIT
exit 19
''',BASE=base,OLD=old,BACKUP=backup,DEST=dest,WORK=pth)
            self.assertEqual(p.returncode,19,p.stderr)
            self.assertEqual((base/'current').resolve(),old)
            self.assertEqual(dest.read_text(),'previous config')

    def test_nginx_draft_uses_only_requested_domain_and_webroot(self):
        p=self.run_bash('DOMAIN=maths.ecole.ma\nnginx_draft yes regam-bac-maths-maths.ecole.ma /var/www/regam-bac-maths/acme')
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('server_name maths.ecole.ma;',p.stdout)
        self.assertIn('location ^~ /.well-known/acme-challenge/',p.stdout)
        self.assertIn('return 301 https://$host$request_uri;',p.stdout)
        self.assertNotIn('default_server',p.stdout)
        self.assertNotIn('live.amicale',p.stdout)
        self.assertEqual(p.stdout.count('{'),p.stdout.count('}'))

    def test_caddy_domain_collision_is_blocked(self):
        with tempfile.TemporaryDirectory() as t:
            p=self.run_bash('''
SERVER=caddy;WORK_DIR="$TEMP";DOMAIN=maths.ecole.ma
STATE_DIR="$TEMP/state";CADDY_SITE="$TEMP/site.caddy"
caddy(){ printf '%s\\n' '{"apps":{"http":{"servers":{"web":{"routes":[{"match":[{"host":["maths.ecole.ma"]}]}]}}}}}'; }
check_domain_collision
''',TEMP=t)
            self.assertNotEqual(p.returncode,0)
            self.assertIn('déjà à un hôte Caddy',p.stderr)

    def test_nginx_wildcard_collision_is_blocked(self):
        with tempfile.TemporaryDirectory() as t:
            p=self.run_bash('''
SERVER=nginx;NGINX_WAS_RUNNING=1;WORK_DIR="$TEMP";DOMAIN=maths.ecole.ma
NGINX_SITE="$TEMP/ours.conf"
nginx(){ printf '%s\\n' '# configuration file /etc/nginx/conf.d/other.conf:' 'server { server_name *.ecole.ma; }'; }
check_domain_collision
''',TEMP=t)
            self.assertNotEqual(p.returncode,0)
            self.assertIn('déjà couvert',p.stderr)

    def test_owned_nginx_domain_is_updatable(self):
        with tempfile.TemporaryDirectory() as t:
            p=self.run_bash('''
SERVER=nginx;NGINX_WAS_RUNNING=1;WORK_DIR="$TEMP";DOMAIN=maths.ecole.ma
NGINX_SITE="$TEMP/ours.conf"
nginx(){ printf '%s\\n' "# configuration file $NGINX_SITE:" 'server { server_name maths.ecole.ma; }' '# configuration file /etc/nginx/conf.d/other.conf:' 'server { server_name live.ecole.ma; }'; }
check_domain_collision
''',TEMP=t)
            self.assertEqual(p.returncode,0,p.stderr)

    def test_only_known_live_docker_layout_is_admitted(self):
        good=live_fixture()
        self.assertEqual(guard.check_live(good,'/opt/regam-live/deploy/Caddyfile'),
                         ('sha256:'+'b'*64,'regam-live_default','c'*64))
        cases=[]
        for key,value in [('project','another-stack'),('running',False),('args',['run','--resume']),('network_mode','host')]:
            bad=copy.deepcopy(good);bad[key]=value;cases.append(bad)
        bad=copy.deepcopy(good);bad['mounts'][0]['RW']=True;cases.append(bad)
        bad=copy.deepcopy(good);bad['mounts'][0]['Source']='/opt/another/Caddyfile';cases.append(bad)
        bad=copy.deepcopy(good);bad['ports']['80/tcp'][0]['HostIp']='127.0.0.1';cases.append(bad)
        bad=copy.deepcopy(good);bad['networks']['another']={};cases.append(bad)
        for bad in cases:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):guard.check_live(bad,'/opt/regam-live/deploy/Caddyfile')

    def test_docker_port_owner_and_alias_collisions_are_refused(self):
        live=live_fixture()
        guard.check_port_owners([live],live['id'])
        other=dict(id='e'*64,ports={'8080/tcp':[dict(HostPort='443',HostIp='0.0.0.0')]})
        with self.assertRaises(ValueError):guard.check_port_owners([live,other],live['id'])
        other=dict(id='e'*64,ports={},networks={'regam-live_default':dict(Aliases=['regam-bac-maths'])})
        with self.assertRaises(ValueError):guard.check_port_owners([live,other],live['id'])

    def test_existing_sidecar_requires_recorded_identity_and_isolation(self):
        good=side_fixture();state=dict(server='caddy-docker',static_container_id=good['id'],static_image=good['image'])
        args=('/var/www/regam-bac-maths','regam-live_default','c'*64,state)
        guard.check_side(good,*args)
        with_tmpfs=copy.deepcopy(good)
        with_tmpfs['mounts'] += [dict(Type='tmpfs',Destination=p,RW=True) for p in ['/tmp','/config','/data']]
        guard.check_side(with_tmpfs,*args)
        cases=[]
        for key,value in [('owner','someone-else'),('project','regam-live'),('running',False),('user','root'),
                          ('privileged',True),('readonly',False),('image','sha256:'+'e'*64),
                          ('port_bindings',{'8080/tcp':[dict(HostPort='8080')]}),('security_opt',[])]:
            bad=copy.deepcopy(good);bad[key]=value;cases.append(bad)
        bad=copy.deepcopy(good);bad['mounts'][0]['RW']=True;cases.append(bad)
        for bad in cases:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):guard.check_side(bad,*args)

    def test_docker_detection_handles_nft_without_listening_socket(self):
        with tempfile.TemporaryDirectory() as t:
            pth=Path(t);config=pth/'Caddyfile';config.write_text('live.ecole.ma { reverse_proxy app:3000 }\n')
            (pth/'live.json').write_text(json.dumps(live_fixture(str(config))))
            (pth/'network.json').write_text(json.dumps(dict(id='c'*64,name='regam-live_default',driver='bridge',
                scope='local',internal=False,ingress=False,project='regam-live')))
            p=self.run_bash('''
WORK_DIR="$TEMP";DOCKER_CADDY_MAIN="$TEMP/Caddyfile"
running(){ return 1; }
ss(){ return 0; }
docker(){
 case "$1" in
  ps) [[ "$2" == -a ]] && return 0;printf '%064d\n' 0 | tr 0 a ;;
  container) cat "$TEMP/live.json" ;;
  network) cat "$TEMP/network.json" ;;
  exec) if [[ "$3" == sha256sum ]];then sha256sum "$DOCKER_CADDY_MAIN";else printf 'v2.10.2\n';fi ;;
  *) return 99 ;;
 esac
}
detect_server
printf 'SERVER=%s\n' "$SERVER"
''',TEMP=t)
            self.assertEqual(p.returncode,0,p.stdout+p.stderr)
            self.assertIn('SERVER=caddy-docker',p.stdout)

    def test_docker_caddy_write_preserves_inode_and_other_hosts(self):
        with tempfile.TemporaryDirectory() as t:
            pth=Path(t);main=pth/'Caddyfile';draft=pth/'draft';state=pth/'state.json'
            original='live.ecole.ma {\n reverse_proxy app:3000\n}\n'
            main.write_text(original);main.chmod(0o640);inode=main.stat().st_ino
            guard.draft(str(main),str(draft),'maths.ecole.ma','prof@ecole.ma','regam-bac-maths',str(state))
            guard.write_in_place(str(draft),str(main))
            self.assertEqual(main.stat().st_ino,inode)
            self.assertEqual(stat.S_IMODE(main.stat().st_mode),0o640)
            self.assertTrue(main.read_text().startswith(original))
            state.write_text(json.dumps(dict(server='caddy-docker',domain='maths.ecole.ma')))
            guard.draft(str(main),str(draft),'maths.ecole.ma','prof@ecole.ma','regam-bac-maths',str(state))
            guard.write_in_place(str(draft),str(main))
            self.assertEqual(main.read_text().count(guard.BEGIN),1)
            self.assertEqual(main.stat().st_ino,inode)

    def test_docker_failure_restores_bound_file_and_removes_only_new_sidecar(self):
        with tempfile.TemporaryDirectory() as t:
            pth=Path(t);main=pth/'Caddyfile';backup=pth/'backup';backup.mkdir()
            main.write_text('new configuration');inode=main.stat().st_ino
            (backup/'Docker-Caddyfile').write_text('previous live configuration')
            p=self.run_bash('''
SERVER=caddy-docker;DOCKER_CADDY_MAIN="$TEMP/Caddyfile";WORK_DIR="$TEMP"
BACKUP_DIR="$TEMP/backup";CONFIG_CHANGED=1;DOCKER_SIDE_CREATED=1
DOCKER_SIDE_ID="$(printf '%064d' 0 | tr 0 d)"
docker(){ printf '%s\n' "$*" >>"$TEMP/docker-calls"; }
reload_server(){ return 0; }
trap on_exit EXIT
exit 23
''',TEMP=t)
            self.assertEqual(p.returncode,23,p.stderr)
            self.assertEqual(main.read_text(),'previous live configuration')
            self.assertEqual(main.stat().st_ino,inode)
            self.assertEqual((pth/'docker-calls').read_text(),'rm\n-f\n'+'d'*64+'\n')

    def test_sidecar_creation_reuses_image_without_host_port_or_compose_labels(self):
        with tempfile.TemporaryDirectory() as t:
            p=self.run_bash('''
DOCKER_IMAGE="sha256:$(printf '%064d' 0 | tr 0 b)";DOCKER_NETWORK=regam-live_default
DOCKER_CADDY_ID="$(printf '%064d' 0 | tr 0 a)";EXPECTED_HEALTH=regam-bac-maths:test
docker(){
 printf '<%s>\n' "$@" >>"$TEMP/docker-calls"
 case "$1" in create) printf '%064d\n' 0 | tr 0 d;; start) return 0;; exec) printf '%s\n' "$EXPECTED_HEALTH";; *) return 99;;esac
}
start_docker_sidecar
printf 'CREATED=%s\n' "$DOCKER_SIDE_CREATED"
''',TEMP=t)
            self.assertEqual(p.returncode,0,p.stderr)
            calls=(Path(t)/'docker-calls').read_text()
            self.assertIn('<--pull>\n<never>',calls)
            self.assertIn('<sha256:'+'b'*64+'>',calls)
            self.assertIn('<65534:65534>',calls)
            self.assertIn('<--read-only>',calls)
            self.assertIn('<type=bind,source=/var/www/regam-bac-maths,target=/srv,readonly>',calls)
            self.assertNotIn('<-p>',calls);self.assertNotIn('<--publish>',calls)
            self.assertNotIn('com.docker.compose',calls)
            self.assertNotIn('<compose>',calls)
            self.assertIn('CREATED=1',p.stdout)

if __name__=='__main__':unittest.main()
