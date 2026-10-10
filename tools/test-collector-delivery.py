"""Local synthetic ZIP regression, including Windows LF and nested roots."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('unpack', Path(__file__).parents[1] / 'deploy/wyz/unpack-candidate.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.helpers = {name: b'committed synthetic helper\n' for name in (
            'upgrade-candidate.sh', 'check-heartbeat-service.py', 'install-schedule-collector.sh',
            'recover-release.py', 'rollback-schedule-collector.sh', 'unpack-candidate.py')}
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            for name, data in self.helpers.items():
                member = tarfile.TarInfo('deploy/wyz/' + name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        source = stream.getvalue()
        name = 'wyz-schedule-collector-' + 'b' * 40 + '.tar.gz'
        digest = hashlib.sha256(source).hexdigest()
        self.files = {**self.helpers, name: source,
                      'upgrade-candidate.json': json.dumps({'fromRevision': 'a' * 40, 'revision': 'b' * 40, 'bundle': name, 'sha256': digest}).encode(),
                      'source.sha256': (digest + '  ' + name + '\n').encode('ascii')}
        self.zip = self.root / 'delivery.zip'
        self.destination = self.root / 'normalized'

    def tearDown(self):
        self.temp.cleanup()

    def make(self, prefix='', extra=None):
        with zipfile.ZipFile(self.zip, 'w') as archive:
            for name, data in self.files.items():
                archive.writestr(prefix + name, data)
            if extra:
                archive.writestr(*extra)
        return hashlib.sha256(self.zip.read_bytes()).hexdigest()

    def test_flat(self):
        module.unpack(self.zip, self.make(), self.destination)
        self.assertEqual((self.destination / 'source.sha256').read_bytes(), self.files['source.sha256'])
        self.assertNotIn(b'\r', (self.destination / 'source.sha256').read_bytes())

    def test_nested(self):
        module.unpack(self.zip, self.make('outer/inner/'), self.destination)
        self.assertTrue((self.destination / 'upgrade-candidate.sh').is_file())
        self.assertEqual(len(list(self.destination.iterdir())), len(self.files))

    def test_hash(self):
        self.make()
        with self.assertRaises(ValueError):
            module.unpack(self.zip, '0' * 64, self.destination)
        self.assertFalse(self.destination.exists())

    def test_crlf_rejected(self):
        self.files['source.sha256'] = self.files['source.sha256'].replace(b'\n', b'\r\n')
        with self.assertRaises(ValueError):
            module.unpack(self.zip, self.make(), self.destination)

    def test_helper_tamper(self):
        self.files['upgrade-candidate.sh'] = b'changed'
        with self.assertRaises(ValueError):
            module.unpack(self.zip, self.make(), self.destination)

    def test_unsafe_members(self):
        for name in ('../outside', '/tmp/outside', 'a\\b', 'other/upgrade-candidate.json', 'other/file', 'a\nfile'):
            with self.assertRaises(ValueError):
                module.unpack(self.zip, self.make(extra=(name, b'unsafe')), self.destination)
            self.assertFalse(self.destination.exists())

    def test_symlink(self):
        item = zipfile.ZipInfo('link')
        item.create_system = 3
        item.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            module.unpack(self.zip, self.make(extra=(item, b'../target')), self.destination)

    def test_existing_destination(self):
        self.destination.mkdir()
        with self.assertRaises(ValueError):
            module.unpack(self.zip, self.make(), self.destination)


if __name__ == '__main__':
    unittest.main()
