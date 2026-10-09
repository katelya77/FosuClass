#!/usr/bin/env bash
# Read-only Oracle diagnostics; never dump env, full configs, raw logs or private keys.
set -euo pipefail
umask 077
sudo -n python3 - <<'PY'
import collections, datetime, glob, json, pathlib, re, subprocess, time

def emit(kind, **data):
    print(json.dumps(dict(kind=kind, **data), ensure_ascii=True), flush=True)

def run(args, timeout=20):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except (OSError, subprocess.TimeoutExpired):
        return -1, '', ''

def probe(label, url, resolve=None):
    args = ['curl', '--noproxy', '*', '--connect-timeout', '6', '--max-time', '12', '--http1.1', '-sS', '-o', '/dev/null', '-A', 'FosuCollectorDiag/oracle']
    if url.startswith('https:'):
        args += ['--proto', '=https']
    if resolve:
        args += ['--resolve', resolve]
    args += ['-w', '%{http_code} %{ssl_verify_result} %{time_connect} %{time_appconnect} %{time_total}', url]
    code, out, _ = run(args)
    parts = out.split()
    emit('probe', label=label, exitCode=code, httpStatus=parts[0] if len(parts)==5 else 'UNKNOWN', verify=parts[1] if len(parts)==5 else 'UNKNOWN', tcpSeconds=parts[2] if len(parts)==5 else None, tlsSeconds=parts[3] if len(parts)==5 else None, totalSeconds=parts[4] if len(parts)==5 else None, authentication='NOT_TESTED', utc=datetime.datetime.now(datetime.timezone.utc).isoformat())

emit('scope', origin='Oracle', readOnly=True, credentials='NOT_READ', schoolRequests=0)
probe('backend-loopback', 'http://127.0.0.1:18318/api/health')
probe('nginx-loopback-tls', 'https://class.katelya.eu.org/api/health', 'class.katelya.eu.org:443:127.0.0.1')
probe('origin-public-ip', 'https://class.katelya.eu.org/api/health', 'class.katelya.eu.org:443:146.235.201.244')
for ip in ['104.21.76.75', '172.67.191.25']:
    time.sleep(15)
    probe('cloudflare-'+ip, 'https://class.katelya.eu.org/api/health', 'class.katelya.eu.org:443:'+ip)

code, names, _ = run(['docker', 'ps', '--format', '{{.Names}}'])
nginx_names = [n for n in names.splitlines() if re.fullmatch(r'[A-Za-z0-9_.-]+', n) and re.search('openresty|nginx', n, re.I)]
mounts = []
for name in nginx_names[:4]:
    c, out, _ = run(['docker', 'inspect', '--format', '{{json .Mounts}}', name])
    try:
        mounts += json.loads(out) if c==0 else []
    except ValueError:
        pass
    c, _, _ = run(['docker', 'exec', name, 'sh', '-c', 'nginx -t >/dev/null 2>&1 || openresty -t >/dev/null 2>&1'])
    emit('nginx-config-check', valid=c==0)

def host_path(value):
    candidates = sorted(mounts, key=lambda item: len(item.get('Destination','')), reverse=True)
    for m in candidates:
        dst = m.get('Destination', '').rstrip('/')
        if dst and (value==dst or value.startswith(dst+'/')):
            return pathlib.Path(m['Source']+value[len(dst):])
    return pathlib.Path(value)

patterns = ['/opt/1panel/apps/openresty/*/conf/conf.d/*.conf', '/opt/1panel/www/conf.d/*.conf', '/etc/nginx/conf.d/*.conf']
for m in mounts:
    src = m.get('Source', '')
    if pathlib.Path(src).is_dir():
        patterns += [src+'/*.conf', src+'/conf.d/*.conf', src+'/conf/conf.d/*.conf']
configs = sorted(set(p for pattern in patterns for p in glob.glob(pattern)))[:100]
logs, found = set(), set()
for filename in configs:
    file = pathlib.Path(filename)
    if not file.is_file() or file.stat().st_size>1024*1024:
        continue
    text = file.read_text(errors='replace')
    for domain in ['class.katelya.eu.org', 'agent-broker.katelya.eu.org']:
        if not re.search(r'server_name\s+[^;]*\b'+re.escape(domain)+r'\b', text):
            continue
        found.add(domain)
        emit('vhost', domain=domain, configFound=True, proxyLoopback18318=bool(re.search(r'proxy_pass\s+http://127\.0\.0\.1:18318\s*;', text)), fullSyncLocation=bool(re.search(r'location\s+[^\n{]*full-sync', text)))
        for match in re.finditer(r'\b(access_log|error_log)\s+([^\s;]+)', text):
            if match[2].startswith('/'):
                logs.add((match[1], str(host_path(match[2].strip('"')))))
        cert = re.search(r'\bssl_certificate\s+([^\s;]+)', text)
        if cert and cert[1].startswith('/'):
            cert_path = host_path(cert[1].strip('"'))
            if cert_path.is_file():
                c, out, _ = run(['openssl', 'x509', '-in', str(cert_path), '-noout', '-issuer', '-subject', '-dates', '-ext', 'subjectAltName'])
                if c==0:
                    fields = [line.strip() for line in out.splitlines() if re.match(r'(issuer=|subject=|notBefore=|notAfter=|DNS:)', line.strip())]
                    emit('certificate', domain=domain, publicFields=fields, originCA='cloudflare' in out.lower())
for domain in ['class.katelya.eu.org', 'agent-broker.katelya.eu.org']:
    if domain not in found:
        emit('vhost', domain=domain, configFound=False)

logs |= {('access_log', p) for p in glob.glob('/opt/1panel/www/sites/class.katelya.eu.org/log/*access*')}
logs |= {('error_log', p) for p in glob.glob('/opt/1panel/www/sites/class.katelya.eu.org/log/*error*')}
window = datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=30)
for kind, name in sorted(logs):
    p = pathlib.Path(name)
    if not p.is_file():
        continue
    with p.open('rb') as f:
        f.seek(max(0, p.stat().st_size-2*1024*1024))
        lines = f.read().decode(errors='replace').splitlines()
    status, tagged, categories = collections.Counter(), collections.Counter(), collections.Counter()
    for line in lines:
        if kind=='access_log':
            stamp = re.search(r'\[([^\]]+)\]', line)
            try:
                when = datetime.datetime.strptime(stamp[1], '%d/%b/%Y:%H:%M:%S %z')
            except (ValueError, TypeError):
                continue
            if when<window:
                continue
            request = re.search(r'"(?:GET|POST) (/api/(?:health|full-sync/v1/heartbeat))(?:\?[^ ]*)? HTTP/[^\"]+" (\d{3})', line)
            if request:
                status[request[1]+':'+request[2]] += 1
                if 'FosuCollectorDiag/wyz' in line:
                    tagged['wyz:'+request[2]] += 1
                elif 'FosuCollectorDiag/oracle' in line:
                    tagged['oracle:'+request[2]] += 1
        else:
            # Only aggregate known categories. No raw messages, addresses or URLs.
            stamp = re.match(r'(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})', line)
            if not stamp:
                continue
            try:
                when = datetime.datetime.strptime(stamp[1], '%Y/%m/%d %H:%M:%S').astimezone(datetime.timezone.utc)
            except ValueError:
                continue
            if when<window:
                continue
            for needle in ['SSL_do_handshake() failed', 'upstream timed out', 'connection reset by peer', 'connect() failed', 'prematurely closed connection']:
                if needle.lower() in line.lower():
                    categories[needle] += 1
    emit('nginx-log-summary', logType=kind, windowMinutes=30, sampledBytes=min(p.stat().st_size,2*1024*1024), routeStatuses=dict(status), diagnosticTags=dict(tagged), errorCategories=dict(categories))

c, sockets, _ = run(['ss', '-lnt'])
emit('listeners', tcp443=bool(re.search(r':443\s', sockets)), loopback18318=bool(re.search(r'127\.0\.0\.1:18318\s', sockets)))
for command in [['ufw', 'status'], ['firewall-cmd', '--query-port=443/tcp']]:
    c, out, _ = run(command)
    emit('host-firewall-summary', tool=command[0], available=c!=-1, exitCode=c, active='active' in out.lower() and 'inactive' not in out.lower(), tcp443Mentioned='443' in out or out.strip()=='yes')
emit('limits', ociSecurityGroup='UNKNOWN_NO_OCI_CONTROL_PLANE', cloudflareSecurityEvents='UNKNOWN_NO_CLOUDFLARE_CONNECTOR', rawLogs='NOT_EXPORTED', configurationChanged=False)
PY
