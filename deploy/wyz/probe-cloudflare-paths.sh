#!/usr/bin/env bash
# Unsigned, bounded path matrix. Does not read env or session, or alter services.
set -euo pipefail
python3 - <<'PY'
import datetime, json, subprocess, time
targets = [('cloudflare-v4-104','104.21.76.75',4),('cloudflare-v4-172','172.67.191.25',4),('oracle-v4','146.235.201.244',4),('cloudflare-v6-3033','2606:4700:3033::ac43:bf19',6),('cloudflare-v6-3034','2606:4700:3034::6815:4c4b',6)]
for index,(label,ip,family) in enumerate(targets):
    address = '['+ip+']' if family==6 else ip
    args=['curl','--noproxy','*','--proto','=https','--http1.1','-'+str(family),'--connect-timeout','6','--max-time','12','--resolve','class.katelya.eu.org:443:'+address,'-A','FosuCollectorDiag/wyz','-sS','-o','/dev/null','-w','%{http_code} %{ssl_verify_result} %{time_connect} %{time_appconnect} %{time_total}','https://class.katelya.eu.org/api/health']
    try:
        p=subprocess.run(args,capture_output=True,text=True,timeout=15)
        parts=p.stdout.split()
        data=dict(label=label,target=ip,family=family,curlExit=p.returncode,utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),authentication='NOT_TESTED',schoolRequests=0)
        if len(parts)==5:
            data.update(http=parts[0],tlsVerified=p.returncode==0 and parts[1]=='0' and float(parts[3])>0,tcpSeconds=parts[2],tlsSeconds=parts[3],totalSeconds=parts[4],failurePhase='none' if p.returncode==0 else 'tcp' if float(parts[2])==0 else 'tls-or-http')
        print(json.dumps(data),flush=True)
    except (OSError,subprocess.TimeoutExpired):
        print(json.dumps(dict(label=label,result='PROBE_FAILED',authentication='NOT_TESTED',schoolRequests=0)),flush=True)
    if index+1<len(targets):
        time.sleep(30)
PY
