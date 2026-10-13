import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("candidate", pathlib.Path(__file__).with_name("build_candidate.py"))
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateTests(unittest.TestCase):
    def test_archive_is_reproducible_and_preserves_base_bytes(self):
        with tempfile.TemporaryDirectory(prefix="fosu-sample-build-") as directory:
            root = pathlib.Path(directory)
            members = {"server/src/app.js": (b"protected-base\n", 0o644), "server/src/shared/sampleCollectionContract.js": (b"candidate\n", 0o644)}
            overlay = {"server/src/shared/sampleCollectionContract.js": {"beforeSha256": None, "sha256": candidate.digest(b"candidate\n")}}
            with patch.object(candidate, "collect", return_value=(members.copy(), overlay)), patch.object(candidate, "git", side_effect=lambda root, *args: candidate.BASE.encode() if args[:2] == ("rev-parse", "HEAD") else b""):
                first = candidate.build(root, root / "first")
                second = candidate.build(root, root / "second")
            self.assertEqual(first["archiveSha256"], second["archiveSha256"])
            self.assertIsNone(first["gitCommit"])
            self.assertEqual(first["baseSha"], candidate.BASE)
            with tarfile.open(root / "first" / first["archive"]) as archive:
                self.assertEqual(archive.extractfile("server/src/app.js").read(), b"protected-base\n")
                manifest = json.load(archive.extractfile("oracle-sample-candidate.json"))
                self.assertIn("BLOCKED", manifest["deploymentBoundary"])

    def test_wrong_checkout_is_rejected_before_reading_runtime(self):
        import subprocess
        with patch.object(candidate, "git", return_value=b"f" * 40 + b"\n"), patch.object(candidate.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "git")):
            with self.assertRaisesRegex(ValueError, "BASE_MISMATCH"):
                candidate.collect(pathlib.Path("unused"))

    def test_environment_and_personal_routes_cannot_be_overlay_targets(self):
        for target in ["server/.env", "server/src/routes/campusAgent.js", "server/docker-compose.yml", "server/src/routes/adminCampusSyncAssets.js", "server/src/services/adminAuth.js", "server/package-lock.json"]:
            self.assertNotIn(target, candidate.ALLOWED)

    def test_requested_admin_integration_has_an_explicit_runtime_allowlist(self):
        requested = {"server/src/routes/adminPages.js", "server/src/routes/adminScheduleCollectorAssets.js", "server/src/services/scheduleCollectorAdminService.js", "server/src/services/serviceTokenService.js", "server/src/security/adminRouteScopes.js"}
        self.assertTrue(requested.issubset(candidate.ALLOWED))
        self.assertNotIn("server/src/routes/admin.js", candidate.ALLOWED)

    def test_incremental_preview_binds_deployed_base_and_keeps_execution_locked(self):
        head = "f" * 40
        members = {"server/src/app.js": (b"unchanged-sample-base\n", 0o644)}
        overlay = {"server/src/services/collectorIncrementalPlanService.js": {"beforeSha256": None, "sha256": "a" * 64}}
        with tempfile.TemporaryDirectory() as directory, patch.object(candidate, "collect", return_value=(members, overlay)) as collect, patch.object(candidate, "git", side_effect=lambda root, *args: head.encode() if args[:2] == ("rev-parse", "HEAD") else b""):
            root = pathlib.Path(directory)
            result = candidate.build(root, root / "output", require_commit=True, incremental_preview=True)
            collect.assert_called_once_with(root, candidate.INCREMENTAL_BASE, candidate.INCREMENTAL_ALLOWED)
            self.assertEqual(result["baseSha"], "7ad3b2708ce553e6fff099fd881a4b9c86ebea39")
            self.assertEqual(result["expectedProductionSha"], result["baseSha"])
            self.assertEqual(result["deploymentBoundary"], "BLOCKED_PENDING_NEW_PRODUCTION_APPROVAL")
            self.assertTrue(result["executionLocked"])
            self.assertFalse(result["fullCollectionApproved"])
            with tarfile.open(root / "output" / result["archive"]) as archive:
                self.assertEqual(archive.extractfile("server/src/app.js").read(), b"unchanged-sample-base\n")

    def test_incremental_preview_does_not_widen_personal_or_sample_ingress_scope(self):
        self.assertEqual(len(candidate.INCREMENTAL_ALLOWED), 5)
        for target in ["server/.env", "server/src/routes/campusAgent.js", "server/docker-compose.yml", "server/src/routes/fullSyncAgent.js", "server/src/services/stagingUploadService.js", "server/package-lock.json"]:
            self.assertNotIn(target, candidate.INCREMENTAL_ALLOWED)

    def test_committed_artifact_rejects_uncommitted_operator_tools(self):
        head = "f" * 40
        members = {"server/src/shared/sampleCollectionContract.js": (b"candidate\n", 0o644)}
        overlay = {"server/src/shared/sampleCollectionContract.js": {"beforeSha256": None, "sha256": candidate.digest(b"candidate\n")}}
        def fake_git(root, *args):
            if args[:2] == ("rev-parse", "HEAD"):
                return head.encode()
            if args[0] == "diff":
                self.assertIn("deploy/oracle-sample/preflight.js", args)
                return b"deploy/oracle-sample/preflight.js\n"
            return b""
        with tempfile.TemporaryDirectory() as directory, patch.object(candidate, "collect", return_value=(members, overlay)), patch.object(candidate, "git", side_effect=fake_git):
            with self.assertRaisesRegex(ValueError, "CANDIDATE_COMMIT_REQUIRED"):
                candidate.build(pathlib.Path(directory), pathlib.Path(directory) / "output", require_commit=True)

    def test_committed_artifact_filename_and_manifest_bind_exact_revision(self):
        head = "f" * 40
        members = {"server/src/shared/sampleCollectionContract.js": (b"candidate\n", 0o644)}
        overlay = {"server/src/shared/sampleCollectionContract.js": {"beforeSha256": None, "sha256": candidate.digest(b"candidate\n")}}
        with tempfile.TemporaryDirectory() as directory, patch.object(candidate, "collect", return_value=(members, overlay)), patch.object(candidate, "git", side_effect=lambda root, *args: head.encode() if args[:2] == ("rev-parse", "HEAD") else b""):
            result = candidate.build(pathlib.Path(directory), pathlib.Path(directory) / "output", require_commit=True)
            self.assertEqual(result["gitCommit"], head)
            self.assertTrue(result["archive"].endswith("-" + head + ".tar.gz"))


if __name__ == "__main__":
    unittest.main()
