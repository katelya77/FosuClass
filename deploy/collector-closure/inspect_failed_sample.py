#!/usr/bin/env python3
"""Python 3.6, local failed-run evidence only; no network, login or replay."""
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import datetime

def private_json(file, enforce=True):
    try:
        file=pathlib.Path(file);s=file.lstat()
        if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>65536:
            return None
        if enforce:
            cursor=file
            while str(cursor)!='/':
                info=cursor.lstat()
                if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or info.st_mode & (0o077 if cursor==file else 0o022):return None
                cursor=cursor.parent
        data=json.loads(file.read_text())
        return data if isinstance(data,dict) else None
    except Exception:return None

def secure_file(file):
    try:
        s=pathlib.Path(file).lstat()
        return stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==0 and s.st_mode&0o077==0
    except Exception:return False

def command(args):
    try:
        p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=10)
        return p.returncode,p.stdout
    except Exception:return 125,''

def iso_ms(value):
    try:return int(datetime.datetime.strptime(value,'%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
    except Exception:return None

def inspect(run,term,revision,worker_sha,state,closure,current,execute=command,enforce=True,request_budget=40):
    if type(request_budget) is not int or request_budget not in [40,120] or not re.fullmatch(r'sc-[a-f0-9]{24}',run) or not re.fullmatch(r'\d{4}-\d{4}-[12]',term) or not re.fullmatch(r'[a-f0-9]{40}',revision) or not re.fullmatch(r'[a-f0-9]{64}',worker_sha):raise ValueError('INSPECT_SCOPE_REJECTED')
    state=pathlib.Path(state);root=pathlib.Path(closure)/run;worker=state/'runs'/term/run
    out={'schema':'collector-failed-sample-inspection.v1','runId':run,'term':term,'readOnly':True,'counterScope':'THIS_READ_ONLY_INSPECTION_ONLY','schoolRequests':0,'passwordSubmissions':0,'replayAllowed':False,'schoolSessionProbed':False,'originalExceptionRetained':'UNKNOWN'}
    try:
        release=pathlib.Path(current).resolve();out['installedRevisionMatch']=release.name==revision
        source=release/'tools/fosu-sync-client/sync.js'
        out['workerSourceMatch']=source.is_file() and not source.is_symlink() and hashlib.sha256(source.read_bytes()).hexdigest()==worker_sha
    except Exception:out['installedRevisionMatch']=False;out['workerSourceMatch']=False
    unit='fosu-collector-sample-'+run[3:]+'.service'
    props=['ActiveState','SubState','Result','ExecMainStatus','ExecMainStartTimestamp','ExecMainExitTimestamp']
    rc,text=execute(['systemctl','show',unit]+['--property='+k for k in props])
    out['systemdQueryExit']=rc
    out['systemd']={k:v for line in text.splitlines() if '=' in line for k,v in [line.split('=',1)] if k in props and len(v)<=100 and re.fullmatch(r'[A-Za-z0-9 _:+.\-/]*',v)}
    out['services']={}
    for name in ['wyz-campus-agent.service','wyz-schedule-collector.service','wyz-schedule-collector.timer']:
        rc,text=execute(['systemctl','is-active',name]);value=text.strip()
        out['services'][name]=value if value in ['active','inactive','failed','activating','deactivating','unknown'] else 'UNKNOWN'
    rc,text=execute(['systemctl','is-enabled','wyz-schedule-collector.timer'])
    out['timerEnabled']=text.strip() if text.strip() in ['disabled','enabled','static','masked','indirect'] else 'UNKNOWN'
    started=private_json(root/'school-access.started.json',enforce);approval=private_json(root/'approval.json',enforce)
    out['schoolAccessReserved']=started is not None
    out['approvalBound']=bool(approval and approval.get('runId')==run and approval.get('term')==term and approval.get('wyzRevision')==revision and approval.get('requestBudget')==request_budget)
    out['worker']={}
    for name in ['worker-status.json','worker-exit.json','sync-result.json']:
        data=private_json(worker/name,enforce);item={'readable':data is not None}
        if data:
            for key in ['code','failurePhase','status','signal']:
                value=data.get(key)
                if isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_\- ]{1,80}',value):item[key]=value
            if type(data.get('workerExitCode')) is int:item['workerExitCode']=data['workerExitCode']
            if type(data.get('schoolRequestCountKnown')) is bool:item['schoolRequestCountKnown']=data['schoolRequestCountKnown']
            if type(data.get('schoolRequestCount')) is int:item['schoolRequestCount']=data['schoolRequestCount']
            if name=='sync-result.json':
                detail=data.get('diagnostic');out['originalExceptionRetained']='SAFE_DIAGNOSTIC_PRESENT' if isinstance(detail,dict) else 'NOT_RETAINED_BY_INSTALLED_WORKER'
                site=detail.get('sourceSite') if isinstance(detail,dict) else None
                if isinstance(site,dict) and site.get('module') in ['sync','worker-receipt'] and all(type(site.get(k)) is int and 0<site[k]<10000000 for k in ['line','column']):item['sourceSite']={k:site[k] for k in ['module','line','column']}
        out['worker'][name]=item
    ledger=private_json(worker/'client/request-ledger.json',enforce);out['requestLedger']='UNKNOWN'
    if ledger and approval:
        scope=ledger.get('scope',{});pending=ledger.get('pending')
        valid=out['approvalBound'] and scope.get('runId')==run and scope.get('term')==term and scope.get('workerSourceHash')==worker_sha and scope.get('requestBudget')==request_budget and scope.get('expiresAt')==approval.get('oracleApprovalExpiresAt',approval.get('expiresAt'))
        valid=valid and hashlib.sha256(json.dumps(scope,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==ledger.get('scopeHash')
        valid=valid and all(type(ledger.get(k)) is int and ledger[k]>=0 for k in ['reserved','completed','failed'])
        if valid:
            reserved=ledger['reserved'];completed=ledger['completed'];failed=ledger['failed']
            valid=reserved<=request_budget and (completed+failed==reserved if pending is None else isinstance(pending,dict) and pending.get('ordinal')==reserved and completed+failed==reserved-1)
        if valid:
            out['requestLedger']={'reserved':reserved,'completed':completed,'failed':failed,'unknown':0 if pending is None else 1,'remaining':request_budget-reserved,'pendingMethod':pending.get('method') if pending and pending.get('method') in ['GET','POST','HEAD'] else None,'pendingResourceType':pending.get('resourceType') if pending and pending.get('resourceType') in ['document','xhr','fetch','script','stylesheet','image','font','other'] else None}
        else:out['requestLedger']='INVALID_SCOPE_OR_COUNTERS'
    progress=private_json(worker/'progress.json',enforce) or {}
    out['sourceProgress']={}
    summaries=progress.get('directSourceSummary',{})
    if isinstance(summaries,dict):
        for kind in ['class','teacher','classroom','course']:
            summary=summaries.get(kind)
            if isinstance(summary,dict):out['sourceProgress'][kind]={k:summary[k] for k in ['discoveredEntities','requestedEntities','success','empty','failed','parserErrors','scheduleDocuments','courseEvents','requestCount'] if type(summary.get(k)) is int and summary[k]>=0}
    out['resourceDirectory']='DOM_NOT_RETAINED'
    directory=private_json(worker/'resource-directory.json',enforce)
    if directory and directory.get('schema')=='collector-resource-directory.v1' and directory.get('runId')==run and directory.get('term')==term and directory.get('source') in ['teacher','classroom','course']:
        detail={'source':directory['source']}
        if directory.get('stage') in ['navigation','term-unavailable','target-check']:detail['stage']=directory['stage']
        for key in ['termMatches','termAvailable','targetDisabled','filteredScope','loading','singleTargetSample','catalogComplete','termRebound']:
            if type(directory.get(key)) is bool:detail[key]=directory[key]
        for key in ['targetControlCount','targetOptionCount','unrecognizedSelectCount']:
            if type(directory.get(key)) is int and 0<=directory[key]<=1000000:detail[key]=directory[key]
        out['resourceDirectory']=detail
    auth=private_json(state/'school-auth-state.json',enforce);start=iso_ms(started.get('at')) if started else None
    try:end=int((root/'result.json').stat().st_mtime*1000)+1000
    except Exception:end=None
    within=lambda value: type(value) is int and start is not None and end is not None and start<=value<=end
    out['authenticationEvidence']={'originalPasswordSubmissionCount':'UNKNOWN','authenticationSchoolRequests':'UNKNOWN','sessionProbeSchoolRequests':'UNKNOWN','authStateReadable':auth is not None}
    if auth:
        out['authenticationEvidence'].update(protectedLoginSucceededInWindow=within(auth.get('lastSuccessAt')),passwordReleaseObservedInWindow=within(auth.get('lastSubmissionReleasedAt')),passwordResponseObservedInWindow=within(auth.get('lastAuthResponseAt')))
    credential=state/'school-credentials.json';fingerprint=private_json(root/'protected-credential-fingerprint.json',enforce)
    out['protectedCredentialsPrivate']=secure_file(credential)
    out['protectedCredentialsUnchanged']='UNKNOWN'
    if fingerprint and out['protectedCredentialsPrivate']:
        out['protectedCredentialsUnchanged']=fingerprint.get('credentialSha256')==hashlib.sha256(credential.read_bytes()).hexdigest()
    out['sessionPrivate']=secure_file(state/'session.json')
    return out

if __name__=='__main__':
    if os.name!='posix' or os.geteuid()!=0 or len(sys.argv) not in [5,6]:raise SystemExit('INSPECT_LINUX_ROOT_AND_EXACT_SCOPE_REQUIRED')
    try:value=inspect(*sys.argv[1:5],state='/var/lib/fosuclass/schedule-collector',closure='/root/fosu-collector-closure',current='/opt/fosuclass/schedule-collector/current',request_budget=int(sys.argv[5]) if len(sys.argv)==6 else 40)
    except Exception:value={'status':'BLOCKED','code':'INSPECT_EVIDENCE_UNREADABLE','readOnly':True,'schoolRequests':0,'passwordSubmissions':0,'replayAllowed':False}
    print(json.dumps(value,ensure_ascii=False))
