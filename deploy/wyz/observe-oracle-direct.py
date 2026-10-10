#!/usr/bin/env python3
"""Passive journal observation; no network or school requests, no raw log output."""
import collections, datetime, json, os, subprocess, time
from pathlib import Path

UNIT = 'wyz-schedule-collector.service'

def props():
    data = subprocess.check_output(['systemctl', 'show', UNIT, '-p', 'NRestarts', '-p', 'MainPID', '-p', 'ActiveState'], universal_newlines=True)
    return dict(line.split('=', 1) for line in data.splitlines() if '=' in line)

def summarize(events, start, end, restarts, pids, active):
    success, failures, connections, fatal = [], 0, [], 0
    failure_start, failure_windows = None, []
    for stamp, record in events:
        if 'acceptanceConnection' in record:
            connections.append(record['acceptanceConnection'])
        elif record.get('mode') == 'heartbeat-only':
            if record.get('networkStatus') in ('healthy', 'recovering') and record.get('retryWaitMs') == 0:
                success.append(stamp)
                if failure_start is not None:
                    failure_windows.append(stamp-failure_start)
                    failure_start = None
            elif record.get('networkStatus') in ('degraded', 'fatal') and record.get('errorCategory'):
                # Cooldown emits the same failure state, not another attempt.
                if record.get('retryWaitMs') != 300000:
                    failures += 1
                    if failure_start is None:
                        failure_start = stamp
                if record.get('networkStatus') == 'fatal':
                    fatal += 1
    times = [start] + sorted(set(success)) + [end]
    gap = max((b-a for a,b in zip(times,times[1:])), default=end-start)
    if failure_start is not None:
        failure_windows.append(end-failure_start)
    verified = [c for c in connections if c.get('phase') == 'complete']
    addresses = sorted(set(c.get('remoteAddress', 'UNKNOWN') for c in verified))
    tls = bool(verified) and all(c.get('tlsAuthorized') is True and c.get('servername') == 'class.katelya.eu.org' for c in verified)
    passed = end-start >= 3600 and len(success) >= 100 and gap < 90 and failures == 0 and fatal == 0 and restarts == 0 and len(pids) == 1 and active and tls and addresses == ['146.235.201.244']
    return dict(durationSeconds=round(end-start,2), successfulHeartbeats=len(success), failedAttempts=failures,
                successfulReusedConnections=sum(c.get('reusedSocket') is True for c in verified),
                successfulNewConnections=sum(c.get('reusedSocket') is not True for c in verified),
                failedConnectionPhases=dict(collections.Counter(c.get('phase') if c.get('phase') in ('connect','tls','response') else 'UNKNOWN' for c in connections if c.get('phase')!='complete')),
                successRate=len(success)/(len(success)+failures) if success or failures else None,
                longestConfirmedHeartbeatGapSeconds=round(gap,2), longestObservedFailureWindowSeconds=round(max(failure_windows,default=0),2), tlsAuthorized=tls, actualAddresses=addresses,
                restarts=restarts, pidCount=len(pids), collectorActive=active, schoolRequests=0,
                acceptance='PASS' if passed else 'NOT_PASSED', schoolAccessApproved=False, timerApproved=False)

def main():
    if os.geteuid() != 0:
        raise SystemExit('ROOT_REQUIRED')
    start = time.time()
    baseline = props()
    if baseline.get('ActiveState') != 'active':
        raise SystemExit('COLLECTOR_NOT_ACTIVE')
    pids = {baseline.get('MainPID')}
    initial_restarts = int(baseline.get('NRestarts', '0'))
    directory = Path('/var/lib/fosuclass/schedule-collector/acceptance')
    if directory.is_symlink() or not directory.is_dir():
        raise SystemExit('ACCEPTANCE_PATH_REJECTED')
    output = directory / ('observation-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
    max_restarts = 0
    while True:
        time.sleep(30)
        end = time.time()
        current = props()
        pids.add(current.get('MainPID'))
        max_restarts = max(max_restarts, int(current.get('NRestarts','0'))-initial_restarts)
        raw = subprocess.check_output(['journalctl', '-u', UNIT, '--since', '@'+str(int(start)), '-o', 'json', '--no-pager'], universal_newlines=True)
        events = []
        for line in raw.splitlines():
            try:
                item = json.loads(line)
                stamp = int(item['__REALTIME_TIMESTAMP'])/1000000
                record = json.loads(item['MESSAGE'])
                if start <= stamp <= end and isinstance(record,dict):
                    events.append((stamp, record))
            except (ValueError, KeyError, TypeError):
                continue
        report = summarize(events, start, end, max_restarts, pids, current.get('ActiveState') == 'active')
        temp = output.with_suffix('.next')
        fd = os.open(temp, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(report, stream, indent=2)
        os.replace(temp, output)
        print(json.dumps(report), flush=True)
        if end-start >= 3600:
            raise SystemExit(0 if report['acceptance']=='PASS' else 1)

if __name__ == '__main__':
    main()
