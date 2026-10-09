#!/usr/bin/env python3
"""Passive Python 3.6-compatible diagnosis. Never print raw journal messages."""
import collections
import datetime
import json
import os
import subprocess

UNITS = ('wyz-schedule-collector.service', 'wyz-campus-agent.service',
         'wyz-schedule-collector.timer')
CATEGORIES = frozenset(('timeout', 'connection-reset', 'connection', 'dns', 'tls',
    'authentication', 'http-server', 'http-rate-limit', 'http-client',
    'protocol', 'unknown-network'))
CODES = frozenset(('ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ECONNREFUSED',
    'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'EAI_FAIL',
    'TimeoutError', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER',
    'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_TLS_HANDSHAKE_TIMEOUT'))


def number(value):
    return value if type(value) in (int, float) and 0 <= value <= 120000 else None


def summarize(lines):
    events = []
    for line in lines:
        try:
            item = json.loads(line)
            record = json.loads(item['MESSAGE'])
            stamp = int(item['__REALTIME_TIMESTAMP']) / 1000000
            if isinstance(record, dict):
                events.append((stamp, record))
        except (ValueError, KeyError, TypeError, OverflowError):
            continue
    counts, phases, failures = collections.Counter(), collections.Counter(), []
    connection, connection_at, successes = {}, None, 0
    for stamp, record in sorted(events, key=lambda event: event[0]):
        c = record.get('acceptanceConnection')
        if isinstance(c, dict) and c.get('mode') == 'oracle-direct':
            phase = c.get('phase')
            connection = dict(
                phase=phase if phase in ('connect', 'tls', 'response', 'complete') else 'UNKNOWN',
                elapsedMs=number(c.get('elapsedMs')),
                tlsAuthorized=c.get('tlsAuthorized') is True,
                originAddressMatches=c.get('remoteAddress') == '146.235.201.244',
                reusedSocket=c.get('reusedSocket') is True)
            connection_at = stamp
            phases[connection['phase']] += 1
        if record.get('mode') != 'heartbeat-only' or record.get('transportMode') != 'oracle-direct':
            continue
        status = record.get('networkStatus')
        if status in ('healthy', 'recovering') and record.get('retryWaitMs') == 0:
            successes += 1
        if status not in ('degraded', 'fatal') or record.get('retryWaitMs') == 300000:
            continue
        category, code = record.get('errorCategory'), record.get('transportCode')
        category = category if isinstance(category, str) and category in CATEGORIES else 'UNKNOWN'
        code = code if isinstance(code, str) and code in CODES else ('NONE' if code is None else 'REDACTED')
        counts[category + '/' + code] += 1
        try:
            utc = datetime.datetime.utcfromtimestamp(stamp).isoformat() + 'Z'
        except (ValueError, OverflowError, OSError):
            utc = 'UNKNOWN'
        # This runner performs sequential heartbeats. Old unrelated connection
        # records must not be presented as evidence about the failed attempt.
        correlated = connection.copy() if connection_at is not None and 0 <= stamp-connection_at <= 20 else {'phase': 'UNKNOWN'}
        failures.append(dict(utc=utc, category=category, code=code,
                             retryWaitMs=number(record.get('retryWaitMs')),
                             connection=correlated))
    return dict(transportMode='oracle-direct', successfulHeartbeats=successes,
                failureCounts=dict(counts), connectionPhases=dict(phases),
                lastFailures=failures[-20:], schoolRequestsByThisDiagnostic=0,
                configurationChanged=False)


def main():
    if os.geteuid() != 0:
        raise SystemExit('ROOT_REQUIRED')
    states = {}
    try:
        for unit in UNITS:
            raw = subprocess.check_output(['systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'NRestarts'],
                                          universal_newlines=True, timeout=15)
            props = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
            state = props.get('ActiveState')
            states[unit] = dict(activeState=state if state in ('active', 'inactive', 'failed', 'activating', 'deactivating') else 'UNKNOWN',
                                restarts=int(props['NRestarts']) if props.get('NRestarts', '').isdigit() else None)
        raw = subprocess.check_output(['journalctl', '-u', UNITS[0], '--since', '2 hours ago',
                                      '-n', '10000', '-o', 'json', '--no-pager'],
                                     universal_newlines=True, timeout=30)
    except (subprocess.SubprocessError, OSError):
        raise SystemExit('PASSIVE_DIAGNOSTIC_READ_FAILED')
    report = summarize(raw.splitlines())
    report.update(windowHours=2, maximumJournalEntries=10000, states=states)
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    main()
