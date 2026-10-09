#!/usr/bin/env bash
# Passive source read only; no school/WAN requests or configuration changes.
set -euo pipefail
sudo -n python3 - <<'PY'
import json, pathlib, re, subprocess
def emit(kind,**values):print(json.dumps(dict(kind=kind,**values)),flush=True)
def run(args):
    try:
        result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=20)
        return result.returncode,result.stdout
    except (OSError,subprocess.TimeoutExpired):return -1,''
emit('passive-control-scope',readOnly=True,schoolRequests=0,wanRequests=0,configurationChanged=False)
code,out=run(['docker','exec','fosuclass-api','node','-e','''
const http=require("http"),token=process.env.ADMIN_API_TOKEN;
if(!token){console.log(JSON.stringify({kind:"live-deployment",status:"UNKNOWN"}));process.exit(0);}
const req=http.get({hostname:"127.0.0.1",port:3000,path:"/api/admin/security/status",headers:{"X-Admin-Token":token},timeout:10000},res=>{let body="";res.on("data",v=>{body+=v;if(body.length>1048576)req.destroy()});res.on("end",()=>{try{const value=JSON.parse(body),sha=value.deployment&&value.deployment.commitSha;console.log(JSON.stringify({kind:"live-deployment",httpStatus:res.statusCode,commitSha:/^[a-f0-9]{40}$/.test(sha||"")?sha:"UNKNOWN"}));}catch{console.log(JSON.stringify({kind:"live-deployment",status:"UNKNOWN"}));}})});req.on("timeout",()=>req.destroy());req.on("error",()=>console.log(JSON.stringify({kind:"live-deployment",status:"UNKNOWN"})));
'''])
for line in out.splitlines():
    try:
        value=json.loads(line)
        if value.get('kind')=='live-deployment':print(json.dumps(value),flush=True)
    except ValueError:pass
if code!=0:emit('live-deployment',status='UNKNOWN')
code,names=run(['docker','ps','--format','{{.Names}}'])
for name in names.splitlines():
    if not re.fullmatch('[A-Za-z0-9_.-]+',name) or not re.search('nginx|openresty',name,re.I):continue
    code,text=run(['docker','exec',name,'sh','-c','nginx -T 2>/dev/null || openresty -T 2>/dev/null'])
    emit('control-keepalive-config',scope='all-loaded-config-summary',configReadable=code==0,
        classVhostPresent=bool(re.search(r'server_name\s+[^;]*\bclass\.katelya\.eu\.org\b',text)),
        configuredIdleTimeouts=re.findall(r'\bkeepalive_timeout\s+([0-9]+(?:ms|s|m|h)?)(?:\s+[0-9]+(?:ms|s|m|h)?)?\s*;',text),
        configuredRequestLimits=re.findall(r'\bkeepalive_requests\s+([0-9]+)\s*;',text),
        classVhostInheritance='REQUIRES_SEPARATE_VERIFICATION')
try:
    lines=pathlib.Path('/proc/net/netstat').read_text().splitlines()
    counters={}
    wanted={'ListenOverflows','ListenDrops','SyncookiesSent','SyncookiesFailed','TCPReqQFullDoCookies','TCPReqQFullDrop'}
    for index in range(0,len(lines)-1,2):
        keys,values=lines[index].split(),lines[index+1].split()
        if keys[0]!='TcpExt:' or values[0]!='TcpExt:':continue
        for key,value in zip(keys[1:],values[1:]):
            if key in wanted and value.isdigit():counters[key]=int(value)
    emit('tcp-listener-counters',scope='host-all-ports-cumulative-not-wyz-specific',counters=counters)
except (OSError,IndexError):emit('tcp-listener-counters',status='UNKNOWN')
PY
