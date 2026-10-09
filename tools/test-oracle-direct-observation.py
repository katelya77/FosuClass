import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('observe', Path(__file__).parents[1] / 'deploy/wyz/observe-oracle-direct.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def records():
    events = []
    for stamp in range(30, 3601, 30):
        events += [(stamp, {'mode':'heartbeat-only','networkStatus':'healthy','retryWaitMs':0}),
                   (stamp, {'acceptanceConnection':{'phase':'complete','tlsAuthorized':True,'servername':'class.katelya.eu.org','remoteAddress':'146.235.201.244'}})]
    return events

good = records()
assert module.summarize(good,0,3600,0,{'123'},True)['acceptance']=='PASS'
assert module.summarize(good,0,3599,0,{'123'},True)['acceptance']=='NOT_PASSED'
assert module.summarize([e for e in good if not 90<=e[0]<=180],0,3600,0,{'123'},True)['acceptance']=='NOT_PASSED'
assert module.summarize(good,0,3600,1,{'123'},True)['acceptance']=='NOT_PASSED'
assert module.summarize(good,0,3600,0,{'123','456'},True)['acceptance']=='NOT_PASSED'
assert module.summarize(good,0,3600,0,{'123'},False)['acceptance']=='NOT_PASSED'
bad_tls=good+[(123,{'acceptanceConnection':{'phase':'complete','tlsAuthorized':False}})]
assert module.summarize(bad_tls,0,3600,0,{'123'},True)['acceptance']=='NOT_PASSED'
bad_ip=good+[(123,{'acceptanceConnection':{'phase':'complete','tlsAuthorized':True,'servername':'class.katelya.eu.org','remoteAddress':'127.0.0.1'}})]
assert module.summarize(bad_ip,0,3600,0,{'123'},True)['acceptance']=='NOT_PASSED'
failed=good+[(123,{'mode':'heartbeat-only','networkStatus':'degraded','retryWaitMs':15000,'errorCategory':'timeout'}),
             (125,{'mode':'heartbeat-only','networkStatus':'degraded','retryWaitMs':300000,'errorCategory':'timeout'})]
r=module.summarize(failed,0,3600,0,{'123'},True)
assert r['failedAttempts']==1 and r['acceptance']=='NOT_PASSED'
assert module.summarize([],0,3600,0,{'123'},True)['acceptance']=='NOT_PASSED'
print('oracle-direct observation: 10 fixture cases PASS; no remote requests')
