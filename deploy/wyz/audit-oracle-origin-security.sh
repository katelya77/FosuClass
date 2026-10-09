#!/usr/bin/env bash
# Read-only source audit. Public metadata/aggregate booleans only.
set -euo pipefail
sudo -n python3 - <<'PY'
import datetime, glob, json, pathlib, re, subprocess
def run(args):
    try:
        value=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=30)
        return value.returncode,value.stdout
    except (OSError,subprocess.TimeoutExpired):
        return -1,''
def emit(kind,**data):
    print(json.dumps(dict(kind=kind,**data)),flush=True)
emit('security-audit-scope',readOnly=True,schoolRequests=0,configurationChanged=False)
code,out=run(['docker','exec','fosuclass-api','node','-e', '''
const http=require("http");
const token=process.env.ADMIN_API_TOKEN;
if(!token){console.log(JSON.stringify({kind:"live-deployment",status:"UNKNOWN_ADMIN_ENV_NOT_AVAILABLE"}));process.exit(0);}
const req=http.get({hostname:"127.0.0.1",port:3000,path:"/api/admin/security/status",headers:{"X-Admin-Token":token},timeout:10000},res=>{let body="";res.on("data",v=>{body+=v;if(body.length>1048576)req.destroy()});res.on("end",()=>{try{const value=JSON.parse(body),sha=value.deployment&&value.deployment.commitSha;console.log(JSON.stringify({kind:"live-deployment",httpStatus:res.statusCode,commitSha:/^[a-f0-9]{40}$/.test(sha||"")?sha:"UNKNOWN"}));}catch{console.log(JSON.stringify({kind:"live-deployment",status:"UNAVAILABLE"}));}})});req.on("timeout",()=>req.destroy());req.on("error",()=>console.log(JSON.stringify({kind:"live-deployment",status:"UNAVAILABLE"})));
'''])
for line in out.splitlines():
    try:
        value=json.loads(line)
        if value.get('kind')=='live-deployment':print(json.dumps(value),flush=True)
    except ValueError:pass
if code!=0:emit('live-deployment',status='UNKNOWN_CONTAINER_UNAVAILABLE')
code,names=run(['docker','ps','--format','{{.Names}}'])
for name in names.splitlines():
    if not re.fullmatch('[A-Za-z0-9_.-]+',name) or not re.search('nginx|openresty',name,re.I):continue
    code,config=run(['docker','exec',name,'sh','-c','nginx -T 2>/dev/null || openresty -T 2>/dev/null'])
    # Inherited directives and included config are inspected, never exported.
    sizes=re.findall(r'\bclient_max_body_size\s+([0-9]+[kKmMgG]?)\s*;',config)
    emit('origin-nginx-controls',configReadable=code==0,fullSyncSpecificLocation=bool(re.search(r'location\s+[^\n{]*full-sync',config)),limitRequestConfigured=bool(re.search(r'\blimit_req\s+',config)),limitRequestZoneConfigured=bool(re.search(r'\blimit_req_zone\s+',config)),bodyLimits=sizes,adminNetworkRestrictionConfigured=bool(re.search(r'location\s+[^\n{]*admin[^}]*\b(?:deny|allow|auth_request)\s',config,re.S)))
for route in ['/api/admin/security/status','/api/full-sync/v1/runs/claim']:
    args=['curl','--noproxy','*','--resolve','class.katelya.eu.org:443:146.235.201.244','--proto','=https','--connect-timeout','6','--max-time','12','-sS','-o','/dev/null','-w','%{http_code} %{ssl_verify_result}','https://class.katelya.eu.org'+route]
    if route.endswith('claim'):args[1:1]=['-X','POST','-H','Content-Type: application/json','--data','{}']
    code,status=run(args)
    emit('origin-unauthenticated-route',route=route,exitCode=code,result=status.strip(),credentialsSent=False)
emit('unverified-controls',ociSecurityGroup='UNKNOWN',certificateAutoRenewal='UNKNOWN',securityAlertDelivery='UNKNOWN',originIpv4ChangeRecovery='MANUAL_APPROVED_PACKAGE_REQUIRED',nonceStore='SOURCE_CURRENTLY_PROCESS_LOCAL')
PY
