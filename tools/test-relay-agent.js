const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";

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

function main() {
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

  console.log("Relay agent smoke test passed.");
}

main();
