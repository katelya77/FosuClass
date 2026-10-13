import hashlib, importlib.util, io, json, pathlib, tarfile, tempfile, unittest
spec = importlib.util.spec_from_file_location('verify_image', pathlib.Path(__file__).resolve().parents[2] / 'deploy/oracle-sample/verify-image.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class ImageGraphTests(unittest.TestCase):
    def make(self, root, change=None):
        revision = 'a'*40
        layer = b'fixture layer bytes'
        ld = 'sha256:' + hashlib.sha256(layer).hexdigest()
        cfg = {'architecture':'arm64','os':'linux','config':{'Labels':{'org.opencontainers.image.revision':revision}},'rootfs':{'type':'layers','diff_ids':[ld]}}
        cb = json.dumps(cfg).encode(); cd = 'sha256:' + hashlib.sha256(cb).hexdigest()
        mf = {'schemaVersion':2,'config':{'digest':cd,'size':len(cb)},'layers':[{'digest':ld,'size':len(layer)}]}
        mb = json.dumps(mf).encode(); md = 'sha256:' + hashlib.sha256(mb).hexdigest()
        ix = {'schemaVersion':2,'manifests':[{'digest':md,'size':len(mb),'annotations':{'org.opencontainers.image.ref.name':revision}}]}
        files = {'index.json':json.dumps(ix).encode(),'blobs/sha256/'+md[7:]:mb,'blobs/sha256/'+cd[7:]:cb,'blobs/sha256/'+ld[7:]:layer}
        if change: change(files)
        archive = root/'fixture.tar.gz'
        with tarfile.open(archive,'w:gz') as tf:
            for name, data in files.items():
                item = tarfile.TarInfo(name);item.size=len(data);tf.addfile(item,io.BytesIO(data))
        inspect = root/'inspect.json';inspect.write_text(json.dumps([{'Id':cd,'Architecture':'arm64','RootFS':{'Type':'layers','Layers':[ld]}}]))
        return archive, inspect, revision, cd, md
    def test_manifest_and_config_ids_are_distinct_but_cryptographically_bound(self):
        with tempfile.TemporaryDirectory() as d:
            args = self.make(pathlib.Path(d));self.assertNotEqual(args[3],args[4])
            result = module.verify(*args);self.assertEqual(result['status'],'PASS');self.assertEqual(result['layersVerified'],1)
    def test_one_changed_layer_byte_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            args = self.make(pathlib.Path(d),lambda f:f.update({next(k for k,v in f.items() if v==b'fixture layer bytes'):b'fixture layer byteX'}))
            with self.assertRaisesRegex(ValueError,'IMAGE_BLOB_DIGEST_MISMATCH'):module.verify(*args)
    def test_wrong_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            args=list(self.make(pathlib.Path(d)));args[4]='sha256:'+'b'*64
            with self.assertRaisesRegex(ValueError,'IMAGE_DESCRIPTOR_MISMATCH'):module.verify(*args)
    def test_wrong_ci_rootfs_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.make(pathlib.Path(d));v=json.loads(args[1].read_text());v[0]['RootFS']['Layers']=['sha256:'+'c'*64];args[1].write_text(json.dumps(v))
            with self.assertRaisesRegex(ValueError,'IMAGE_ROOTFS_MISMATCH'):module.verify(*args)
    def test_unknown_archive_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.make(pathlib.Path(d),lambda f:f.update({'../untrusted':b'fixture'}))
            with self.assertRaisesRegex(ValueError,'IMAGE_ARCHIVE_PATH_REJECTED'):module.verify(*args)
    def test_another_revision_cannot_reuse_the_graph(self):
        with tempfile.TemporaryDirectory() as d:
            args=list(self.make(pathlib.Path(d)));args[2]='b'*40
            with self.assertRaisesRegex(ValueError,'IMAGE_TAG_REJECTED'):module.verify(*args)

if __name__=='__main__':unittest.main()
