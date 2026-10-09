import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("recover", Path(__file__).parent.parent / "deploy/wyz/recover-release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.destination = self.root / "release"
        self.bundle = self.root / "bundle.tar.gz"

    def tearDown(self):
        self.temporary.cleanup()

    def archive(self, entries):
        with tarfile.open(self.bundle, "w:gz") as archive:
            for name, kind in entries:
                member = tarfile.TarInfo(name)
                if kind == "file":
                    member.size = 2
                    archive.addfile(member, io.BytesIO(b"ok"))
                else:
                    member.type = tarfile.SYMTYPE if kind == "link" else tarfile.CHRTYPE
                    member.linkname = "../outside"
                    archive.addfile(member)

    def test_partial_resume_and_idempotency(self):
        self.archive([("a/file.js", "file"), ("other.json", "file")])
        (self.destination / "a").mkdir(parents=True)
        source = self.destination / "a/file.js"
        source.write_bytes(b"ok")
        modified = source.stat().st_mtime_ns
        module.recover(self.bundle, self.destination)
        module.recover(self.bundle, self.destination)
        self.assertEqual(modified, source.stat().st_mtime_ns)

    def test_corrupt_source_is_preserved(self):
        self.destination.mkdir()
        (self.destination / "file").write_bytes(b"changed")
        self.archive([("file", "file"), ("missing", "file")])
        with self.assertRaisesRegex(ValueError, "CORRUPTED"):
            module.recover(self.bundle, self.destination)
        self.assertFalse((self.destination / "missing").exists())

    def test_traversal_absolute_and_backslash(self):
        for name in ["../outside", "a/../../outside", "/tmp/outside", "a\\outside", "a\nfile"]:
            self.archive([("valid", "file"), (name, "file")])
            with self.assertRaises(ValueError):
                module.recover(self.bundle, self.destination)
            self.assertFalse(self.destination.exists())

    def test_links_and_devices(self):
        for kind in ["link", "device"]:
            self.archive([("unsafe", kind)])
            with self.assertRaises(ValueError):
                module.recover(self.bundle, self.destination)

    def test_duplicates(self):
        self.archive([("duplicate", "file"), ("duplicate", "file")])
        with self.assertRaises(ValueError):
            module.recover(self.bundle, self.destination)

    def test_existing_parent_symlink(self):
        self.destination.mkdir()
        (self.root / "outside").mkdir()
        (self.destination / "a").symlink_to(self.root / "outside", target_is_directory=True)
        self.archive([("a/file", "file")])
        with self.assertRaisesRegex(ValueError, "SYMLINK"):
            module.recover(self.bundle, self.destination)


if __name__ == "__main__":
    unittest.main()
