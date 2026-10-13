#!/usr/bin/env python3
"""Python 3.6: inspect the installed worker offline; never mount a real Session.

Container checks use the already pinned local image with --network=none.
No service, source, credential, timer, or previous run is modified.
"""
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess

STATE = pathlib.Path('/var/lib/fosuclass/schedule-collector')
CURRENT = pathlib.Path('/opt/fosuclass/schedule-collector/current')
REVISION = '0af13014d4e937e3395a2e7d35ac2b32b3d7deff'
FILES = ['tools/fosu-sync-client/sync.js',
         'tools/wyz-schedule-collector/collector.js',
         'tools/wyz-schedule-collector/container-worker.js']

def command(args, timeout=15, env=None):
    p = None
    try:
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             universal_newlines=True, env=env, start_new_session=True)
        stdout, ignored = p.communicate(timeout=timeout)
        return p.returncode, stdout
    except subprocess.TimeoutExpired:
        # Own only this helper process group. A browser child cannot outlive
        # the diagnostic timeout; production services never enter this group.
        if p is not None:
            os.killpg(p.pid, signal.SIGKILL)
            p.communicate()
        return 124, ''
    except Exception:
        return 125, ''

def inspect():
    out = {'readOnly': True, 'schoolRequests': 0, 'passwordSubmissions': 0,
           'realSessionMounted': False, 'replayAllowed': False}
    resolved = CURRENT.resolve()
    out['installedRevisionMatch'] = resolved.name == REVISION
    out['hostSourceHashes'] = {}
    for name in FILES:
        f = resolved / name
        if f.is_file() and not f.is_symlink():
            out['hostSourceHashes'][name] = hashlib.sha256(f.read_bytes()).hexdigest()
    runtime = STATE / 'browser-runtime.json'
    try:
        s = runtime.lstat()
        if not runtime.is_file() or runtime.is_symlink() or s.st_uid or s.st_mode & 0o077:
            raise ValueError()
        value = json.loads(runtime.read_text())
    except Exception:
        out['code'] = 'BROWSER_RUNTIME_UNREADABLE_OR_UNSAFE'
        return out
    out['runtimeMode'] = value.get('mode') if value.get('mode') in ['native', 'container'] else 'UNKNOWN'
    if value.get('mode') == 'native':
        return inspect_native(out, resolved)
    if value.get('mode') != 'container':
        out['code'] = 'BROWSER_CONTAINER_CHECK_NOT_APPLICABLE'
        return out
    engine, image = value.get('engine'), value.get('image')
    if engine not in ['podman', 'docker'] or not re.fullmatch(r'sha256:[a-f0-9]{64}', str(image)):
        out['code'] = 'BROWSER_RUNTIME_REJECTED'
        return out
    out['engine'], out['pinnedImage'] = engine, image
    rc, raw = command(['/usr/bin/' + engine, 'image', 'inspect', '--format', '{{.Id}}', image])
    out['imageInspectExit'] = rc
    out['localImagePinMatch'] = rc == 0 and raw.strip() == image
    if not out['localImagePinMatch']:
        out['code'] = 'BROWSER_LOCAL_IMAGE_PIN_MISMATCH'
        return out
    # Only a synthetic empty Session is created in ephemeral /tmp. No real
    # directory, Session, secrets, engine socket, or school network is exposed.
    javascript = r'''
const fs=require('fs'),crypto=require('crypto');
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
console.log=console.warn=console.error=()=>{};
const safe=e=>/^[A-Z][A-Z0-9_]{1,70}$/.test(e&&e.code||'')?e.code:'WORKER_UNTYPED_FAILURE';
(async()=>{
 let out={};
 out.imageSourceHashes={};
 for(const f of %s){try{out.imageSourceHashes[f]=crypto.createHash('sha256').update(fs.readFileSync('/collector/'+f)).digest('hex');}catch(e){out.imageSourceHashes[f]=safe(e);}}
 fs.mkdirSync('/tmp/fosu-offline-client',{recursive:true,mode:0o700});
 fs.writeFileSync('/tmp/fosu-offline-session.json',JSON.stringify({cookies:[],origins:[]}),{mode:0o600});
 Object.assign(process.env,{FOSU_COLLECTOR_MODE:'1',FOSU_SYNC_HEADLESS:'1',FOSU_SYNC_DATA_DIR:'/tmp/fosu-offline-client',FOSU_COLLECTOR_SESSION:'/tmp/fosu-offline-session.json',FOSU_STORAGE_DIR:'/tmp/fosu-offline-storage'});
 let sync;
 try{sync=require('/collector/tools/fosu-sync-client/sync.js');out.syncImport='PASS';}
 catch(e){out.syncImport='BLOCKED';out.importCode=safe(e);emit(out);return;}
 let b,c;
 try{({browser:b,context:c}=await sync.initBrowserContext());const p=await c.newPage();await p.close();out.workerBrowserContext='PASS';}
 catch(e){out.workerBrowserContext='BLOCKED';out.browserCode=safe(e);}
 finally{if(c)await c.close().catch(()=>{});if(b)await b.close().catch(()=>{});}
 emit(out);
})().catch(e=>{emit({code:safe(e)});process.exitCode=1;});
''' % json.dumps(FILES)
    helper = 'fosu-offline-worker-inspect-' + str(os.getpid())
    args = ['/usr/bin/' + engine, 'run', '--rm', '--pull=never', '--init', '--name', helper,
            '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--read-only', '--cpus=1', '--memory=768m', '--pids-limit=256',
            '--shm-size=256m', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
            '--workdir', '/collector', image, 'node', '-e', javascript]
    rc, raw = command(args, timeout=45)
    if rc in [124, 125]:
        # A lost CLI must not leave even this network-isolated helper running.
        command(['/usr/bin/' + engine, 'rm', '-f', helper], timeout=10)
    out['offlineContainerExit'] = rc
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError()
        # The exact in-image program returns only hashes, statuses and codes.
        out['offlineWorker'] = data
        out['imageSourceMatchesInstalled'] = data.get('imageSourceHashes') == out['hostSourceHashes']
    except Exception:
        out['code'] = 'BROWSER_OFFLINE_RECEIPT_MISSING'
    return out

def inspect_native(out, release):
    if release != pathlib.Path('/opt/fosuclass/schedule-collector/releases') / REVISION:
        out['code'] = 'BROWSER_NATIVE_SOURCE_PIN_REQUIRED'
        return out
    # Namespace isolation also blocks Chromium subprocesses, unlike merely
    # stubbing Node HTTP methods. If unavailable, do not launch the browser.
    rc, ignored = command(['/usr/bin/unshare', '--net', '/usr/bin/true'])
    out['nativeNetworkIsolationExit'] = rc
    if rc != 0:
        out['code'] = 'BROWSER_NATIVE_OFFLINE_ISOLATION_UNAVAILABLE'
        return out
    javascript = r'''
const fs=require('fs'),os=require('os'),path=require('path');
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
console.log=console.warn=console.error=()=>{};
const safe=e=>/^[A-Z][A-Z0-9_]{1,70}$/.test(e&&e.code||'')?e.code:'WORKER_UNTYPED_FAILURE';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fosu-native-offline-'));
 let out={nodeVersion:process.version},b,c;
 try{
  fs.writeFileSync(path.join(root,'session.json'),JSON.stringify({cookies:[],origins:[]}),{mode:0o600});
  Object.assign(process.env,{FOSU_COLLECTOR_MODE:'1',FOSU_SYNC_HEADLESS:'1',FOSU_SYNC_DATA_DIR:root,FOSU_COLLECTOR_SESSION:path.join(root,'session.json'),FOSU_STORAGE_DIR:path.join(root,'storage'),PLAYWRIGHT_BROWSERS_PATH:%s,FOSU_COLLECTOR_SAMPLE_KIND:'class',FOSU_COLLECTOR_REQUEST_BUDGET:'40'});
  let sync;
  try{sync=require(%s);out.syncImport='PASS';}catch(e){out.syncImport='BLOCKED';out.importCode=safe(e);return;}
  try{({browser:b,context:c}=await sync.initBrowserContext());const p=await c.newPage();await p.close();out.workerBrowserContext='PASS';}catch(e){out.workerBrowserContext='BLOCKED';out.browserCode=safe(e);}
 }finally{
  if(c)await c.close().catch(()=>{});if(b)await b.close().catch(()=>{});
  fs.rmSync(root,{recursive:true,force:true});emit(out);
 }
})().catch(e=>{emit({code:safe(e)});process.exitCode=1;});
''' % (json.dumps(str(STATE / 'browsers')), json.dumps(str(release / FILES[0])))
    # Unit uses /usr/bin/node. Never inherit full-sync or school credentials.
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}
    rc, raw = command(['/usr/bin/unshare', '--net', '/usr/bin/node', '-e', javascript], timeout=45, env=env)
    out['offlineNativeExit'] = rc
    try:
        out['offlineWorker'] = json.loads(raw)
    except Exception:
        out['code'] = 'BROWSER_OFFLINE_RECEIPT_MISSING'
    rc, raw = command(['journalctl', '-k', '--since', '2026-10-13 16:56:00',
                       '--until', '2026-10-13 16:59:00', '-o', 'json', '--no-pager'])
    events = []
    for line in raw.splitlines():
        try:
            message = str(json.loads(line).get('MESSAGE', ''))
            if re.search(r'out of memory|oom-kill|Killed process', message, re.I):
                events.append('OOM_EVENT')
            elif 'segfault' in message:
                events.append('SEGFAULT_EVENT')
        except Exception:
            pass
    out['kernelQueryExit'] = rc
    out['kernelEventsInRunWindow'] = dict((k, events.count(k)) for k in set(events))
    return out

if __name__ == '__main__':
    print(json.dumps(inspect(), ensure_ascii=False, indent=2))
