import ast
import importlib.util
import json
from pathlib import Path

source = Path(__file__).parents[1] / 'deploy/wyz/diagnose-oracle-direct.py'
ast.parse(source.read_text(), feature_version=(3, 6))
spec = importlib.util.spec_from_file_location('diagnose', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def entry(stamp, record):
    return json.dumps({'__REALTIME_TIMESTAMP': str(int(stamp*1000000)),
                       'MESSAGE': json.dumps(record)})


def failure(stamp, **extra):
    return entry(stamp, dict(mode='heartbeat-only', transportMode='oracle-direct',
        networkStatus='degraded', retryWaitMs=15000, errorCategory='timeout',
        transportCode='ETIMEDOUT', **extra))


connection = entry(10, {'acceptanceConnection': dict(mode='oracle-direct', phase='connect',
    elapsedMs=6001, remoteAddress=None, tlsAuthorized=False, reusedSocket=False)})
report = module.summarize([failure(11), connection])
assert report['failureCounts'] == {'timeout/ETIMEDOUT': 1}
assert report['lastFailures'][0]['connection']['phase'] == 'connect'
assert report['lastFailures'][0]['connection']['elapsedMs'] == 6001
cooldown = entry(12, dict(mode='heartbeat-only', transportMode='oracle-direct',
    networkStatus='degraded', retryWaitMs=300000, errorCategory='timeout'))
assert module.summarize([failure(11), cooldown])['failureCounts'] == {'timeout/ETIMEDOUT': 1}
assert module.summarize([connection, failure(35)])['lastFailures'][0]['connection'] == {'phase': 'UNKNOWN'}
assert module.summarize([entry(12, dict(mode='execute', transportMode='oracle-direct',
    networkStatus='degraded', retryWaitMs=15000, errorCategory='timeout'))])['failureCounts'] == {}
assert module.summarize([entry(12, dict(mode='heartbeat-only', transportMode='cloudflare-default',
    networkStatus='degraded', retryWaitMs=15000, errorCategory='timeout'))])['failureCounts'] == {}
secret = 'synthetic-private-marker'
hostile = entry(12, dict(mode='heartbeat-only', transportMode='oracle-direct',
    networkStatus='degraded', retryWaitMs=secret, errorCategory=secret,
    transportCode=secret, cookie=secret, authorization=secret))
malformed = entry(13, dict(mode='heartbeat-only', transportMode='oracle-direct',
    networkStatus='degraded', retryWaitMs=False, errorCategory={'private': secret}, transportCode={'private': secret}))
assert secret not in json.dumps(module.summarize([hostile, malformed, 'not JSON']))
assert module.summarize([failure(i) for i in range(30)])['lastFailures'].__len__() == 20
assert module.summarize([entry(11, dict(mode='heartbeat-only', transportMode='oracle-direct',
    networkStatus='healthy', retryWaitMs=0))])['successfulHeartbeats'] == 1
assert module.number(True) is None and module.number(-1) is None and module.number(120001) is None
print('oracle-direct passive diagnosis: 9 fixture cases PASS; Python 3.6 syntax; no network requests')
