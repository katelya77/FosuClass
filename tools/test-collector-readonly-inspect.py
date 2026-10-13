import ast
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]

def load(name):
    file = ROOT / 'deploy' / 'collector-closure' / (name + '.py')
    spec = importlib.util.spec_from_file_location(name, str(file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

class Inspect(unittest.TestCase):
    def test_python36_subprocess_contract(self):
        for name in ['inspect_class_result', 'inspect_worker_runtime']:
            text = (ROOT / 'deploy' / 'collector-closure' / (name + '.py')).read_text()
            tree = ast.parse(text, feature_version=(3, 6))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    self.assertFalse({'capture_output', 'text'} & set(k.arg for k in node.keywords))

    def test_receipt_scrubbing_and_symlink(self):
        m = load('inspect_class_result')
        with tempfile.TemporaryDirectory() as d:
            f = pathlib.Path(d) / 'result.json'
            f.write_text(json.dumps({'status': 'BLOCKED', 'code': 'SYNC_FAILED',
                                    'account': 'fixture-private', 'password': 'fixture-private',
                                    'message': 'fixture-private', 'cookies': ['fixture-private'],
                                    'passwordSubmissions': -1, 'schoolRequestCount': True}))
            self.assertEqual(m.read(f), {'exists': True, 'status': 'BLOCKED', 'code': 'SYNC_FAILED'})
            f.write_text('invalid')
            self.assertEqual(m.read(f)['read'], 'INVALID_OR_UNREADABLE')
            f.write_text(' ' * 1048577)
            self.assertEqual(m.read(f)['read'], 'TOO_LARGE')
            link = pathlib.Path(d) / 'link'
            try:
                link.symlink_to(f)
            except OSError:
                return
            self.assertEqual(m.read(link), {'exists': False})

    def test_missing_systemd_is_structured(self):
        m = load('inspect_class_result')
        with tempfile.TemporaryDirectory() as d, patch.object(m.subprocess, 'run', side_effect=OSError('private')):
            m.ROOT = m.WORKER = pathlib.Path(d)
            out = m.inspect()
            self.assertEqual(out['systemdQuery'], 'UNAVAILABLE_OR_TIMEOUT')
            self.assertNotIn('private', json.dumps(out))

    def test_offline_pinned_no_real_mount_and_no_pull(self):
        m = load('inspect_worker_runtime')
        with tempfile.TemporaryDirectory() as d:
            m.STATE = pathlib.Path(d)
            m.CURRENT = pathlib.Path(d) / m.REVISION
            m.CURRENT.mkdir()
            for name in m.FILES:
                p = m.CURRENT / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text('fixture')
            image = 'sha256:' + 'a' * 64
            runtime = m.STATE / 'browser-runtime.json'
            runtime.write_text(json.dumps({'mode': 'container', 'engine': 'podman', 'image': image}))
            runtime.chmod(0o600)
            calls = []
            def command(args, timeout=15):
                calls.append(args)
                if args[1:3] == ['image', 'inspect']:
                    return 0, image
                return 0, json.dumps({'syncImport': 'PASS', 'workerBrowserContext': 'PASS',
                                     'imageSourceHashes': dict((f, m.hashlib.sha256(b'fixture').hexdigest()) for f in m.FILES)})
            class Stat:
                st_uid = 0
                st_mode = 0o100600
            original = pathlib.Path.lstat
            with patch.object(m, 'command', command), patch.object(pathlib.Path, 'lstat', lambda p: Stat() if p == runtime else original(p)):
                out = m.inspect()
            self.assertTrue(out['imageSourceMatchesInstalled'])
            args = calls[-1]
            self.assertIn('--network=none', args)
            self.assertIn('--pull=never', args)
            self.assertIn('--read-only', args)
            self.assertNotIn('--mount', args)
            self.assertFalse(out['realSessionMounted'])
            self.assertEqual(out['passwordSubmissions'], 0)

    def test_native_refuses_to_launch_without_network_isolation(self):
        m = load('inspect_worker_runtime')
        calls = []
        def command(args, timeout=15, env=None):
            calls.append(args)
            return 1, ''
        with patch.object(m, 'command', command):
            out = m.inspect_native({}, pathlib.Path('/opt/fosuclass/schedule-collector/releases') / m.REVISION)
        self.assertEqual(out['code'], 'BROWSER_NATIVE_OFFLINE_ISOLATION_UNAVAILABLE')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], ['/usr/bin/unshare', '--net', '/usr/bin/true'])

    def test_native_helper_inherits_no_credentials(self):
        m = load('inspect_worker_runtime')
        calls = []
        def command(args, timeout=15, env=None):
            calls.append((args, env))
            if '-e' in args:
                return 0, '{"syncImport":"PASS","workerBrowserContext":"PASS"}'
            return 0, ''
        with patch.object(m, 'command', command):
            out = m.inspect_native({}, pathlib.Path('/opt/fosuclass/schedule-collector/releases') / m.REVISION)
        self.assertEqual(out['offlineWorker']['syncImport'], 'PASS')
        args, env = calls[1]
        self.assertEqual(set(env), {'PATH', 'HOME', 'LANG'})
        self.assertEqual(args[:4], ['/usr/bin/unshare', '--net', '/usr/bin/node', '-e'])
        self.assertNotIn('checkSession(', args[-1])
        self.assertNotIn('.goto(', args[-1])

if __name__ == '__main__':
    unittest.main()
