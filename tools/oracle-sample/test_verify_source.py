import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

ENTRY = Path(__file__).resolve().parents[2] / "deploy/oracle-sample/verify-source.py"
spec = importlib.util.spec_from_file_location("verify_source", ENTRY)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VerifySourceTests(unittest.TestCase):
    def test_private_modes_keep_same_bytes_but_one_byte_changes_and_extras_fail(self):
        with tempfile.TemporaryDirectory(prefix="fosu-source-verification-") as directory:
            root = Path(directory).resolve()
            candidate = root / "candidate"
            candidate.mkdir(mode=0o700)
            source = candidate / "source.js"
            source.write_bytes(b"fixed source bytes\n")
            source.chmod(0o600)
            archive_file = root / "source.tar.gz"
            with tarfile.open(archive_file, "w:gz") as archive:
                member = tarfile.TarInfo("source.js")
                member.mode = 0o644
                member.size = len(source.read_bytes())
                archive.addfile(member, io.BytesIO(source.read_bytes()))
            before = source.stat().st_mode
            result = module.verify(archive_file, candidate)
            self.assertEqual(result["status"], "PASS")
            self.assertTrue(result["exactFileSet"])
            self.assertEqual(result["writes"], 0)
            self.assertEqual(source.stat().st_mode, before)
            source.write_bytes(b"Fixed source bytes\n")
            with self.assertRaisesRegex(module.VerificationError, "SOURCE_FILE_CONTENT_MISMATCH"):
                module.verify(archive_file, candidate)
            source.write_bytes(b"fixed source bytes\n")
            (candidate / "unapproved-extra.txt").write_bytes(b"extra")
            with self.assertRaisesRegex(module.VerificationError, "SOURCE_FILE_SET_MISMATCH"):
                module.verify(archive_file, candidate)


if __name__ == "__main__":
    unittest.main()
