const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_PASSWORD = "test-admin-password";
const tempRoot = path.join(os.tmpdir(), `fosu-relay-agent-test-${process.pid}-${Date.now()}`);
process.env.RELAY_DIR = tempRoot;
process.env.STAGING_DIR = path.join(tempRoot, "staging");

const relayService = require("../server/src/services/relayService");

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`${filePath} syntax check failed\n${result.stdout}\n${result.stderr}`);
  }
}

function assertThrowsStatus(fn, statusCode, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, message);
  assert.strictEqual(thrown.statusCode, statusCode, message);
}

function buildSnapshot(releaseVersion) {
  return {
    schemaVersion: 1,
    releaseVersion: releaseVersion || "relay-test-2026-06-02",
    term: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-02T00:00:00.000Z",
    catalog: { colleges: [], grades: ["2025"] },
    majors: [],
    classSchedules: [{
      className: "25接力测试1班",
      semester: "2025-2026-2",
      courses: [{
        courseName: "接力测试课程",
        teacherName: "接力教师",
        weekday: 1,
        sections: [1, 2],
      }],
    }],
    resources: {
      teacherSchedules: [{ teacherName: "接力教师", courses: [] }],
      classroomSchedules: [{ roomName: "C7-101", courses: [] }],
      courseSchedules: [{ courseName: "接力测试课程", courses: [] }],
      classrooms: [{ roomName: "C7-101" }],
      teachers: [{ teacherName: "接力教师" }],
      courses: [{ courseName: "接力测试课程" }],
    },
  };
}

async function withServer(handler) {
  const express = require(require.resolve("express", { paths: [path.join(__dirname, "../server")] }));
  const adminRouter = require("../server/src/routes/admin");
  const relayRouter = require("../server/src/routes/relay");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/admin", adminRouter);
  app.use("/api/relay", relayRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const address = server.address();
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const agentPath = path.join(root, "tools/fosu-relay-agent/relay-agent.js");
  const buildPath = path.join(root, "tools/fosu-relay-agent/build.js");
  runNodeCheck(agentPath);
  runNodeCheck(buildPath);

  const agentSource = fs.readFileSync(agentPath, "utf-8");
  assert(agentSource.includes("uploadStagingFile"), "relay agent should use shared chunk upload helper");
  assert(agentSource.includes("scanFileForSensitiveData"), "relay agent should guard sensitive data before upload");
  assert(!/JSON\.parse\(fs\.readFileSync\(filePath,\s*[\"']utf-8[\"']\)\)/.test(agentSource), "relay agent should not parse full staging JSON into memory");

  const task = relayService.createTask({
    term: "2025-2026-2",
    description: "relay smoke test",
    expiresInHours: 1,
    maxUploads: 1,
  });
  try {
    assert(task.id, "relay task should have id");
    assert(task.relayToken, "relay task should have token");
    const validated = relayService.validateTokenForUpload(task.relayToken);
    assert.strictEqual(validated.id, task.id, "relay token should validate for its task");
    assertThrowsStatus(() => relayService.validateTokenForUpload("invalid-token"), 404, "invalid relay token should be rejected");

    const revoked = relayService.revokeTask(task.id);
    assert.strictEqual(revoked.status, "revoked", "relay task should be revoked");
    assertThrowsStatus(() => relayService.validateTokenForUpload(task.relayToken), 403, "revoked relay token should be rejected");
  } finally {
    relayService.deleteTask(task.id);
  }

  const uploadTask = relayService.createTask({
    term: "2025-2026-2",
    description: "relay upload smoke test",
    expiresInHours: 1,
    maxUploads: 1,
  });
  try {
    await withServer(async (baseUrl) => {
      const adminRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
        headers: { "x-relay-token": uploadTask.relayToken },
      });
      assert.strictEqual(adminRes.status, 401, "relay token must not access admin dashboard");

      const uploadRes = await fetch(`${baseUrl}/api/relay/staging/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-relay-token": uploadTask.relayToken,
        },
        body: JSON.stringify(buildSnapshot("relay-test-upload-1")),
      });
      const uploadBody = await uploadRes.json();
      assert.strictEqual(uploadRes.status, 200, "relay token upload should succeed");
      assert.strictEqual(uploadBody.upload.status, "pending-review", "relay upload should be pending-review");

      const secondRes = await fetch(`${baseUrl}/api/relay/staging/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-relay-token": uploadTask.relayToken,
        },
        body: JSON.stringify(buildSnapshot("relay-test-upload-2")),
      });
      assert.strictEqual(secondRes.status, 403, "relay token over max upload count should be rejected");
    });
  } finally {
    relayService.deleteTask(uploadTask.id);
  }

  const expiredTask = relayService.createTask({
    term: "2025-2026-2",
    description: "expired relay smoke test",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    maxUploads: 1,
  });
  try {
    assertThrowsStatus(() => relayService.validateTokenForUpload(expiredTask.relayToken), 403, "expired relay token should be rejected");
  } finally {
    const deleted = relayService.deleteTask(expiredTask.id);
    assert.strictEqual(deleted, true, "admin should delete relay task");
  }

  const resolvedRoot = path.resolve(tempRoot);
  const relativeRoot = path.relative(os.tmpdir(), resolvedRoot);
  if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot) || !path.basename(resolvedRoot).startsWith("fosu-relay-agent-test-")) {
    throw new Error(`refusing to remove unexpected temp directory: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
  console.log("Relay agent smoke test passed.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
