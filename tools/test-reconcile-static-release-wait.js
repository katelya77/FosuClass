const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const storage = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-reconcile-wait-"));
process.env.FOSU_STORAGE_DIR = storage;
const jobService = require("../server/src/services/jobService");
const script = path.join(__dirname, "../server/scripts/reconcile-static-release.js");

function run(version) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--version=" + version], {
      env: Object.assign({}, process.env, {
        FOSU_STORAGE_DIR: storage,
        FOSU_RECONCILE_POLL_MS: "200",
        FOSU_RECONCILE_WAIT_MS: "4000",
      }),
      cwd: path.join(__dirname, ".."),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const same = jobService.createExternalJob("static-release-reconcile", { version: "rel-a" }, { lockGroup: "release-heavy" });
  jobService.startJob(same.id, { workerPid: process.pid });
  setTimeout(() => {
    jobService.finishJobSuccess(same.id, { staticSync: { success: true, releaseVersion: "rel-a" } });
  }, 400);
  const joined = await run("rel-a");
  assert.strictEqual(joined.code, 0, joined.stderr);
  const joinedBody = JSON.parse(joined.stdout);
  assert.strictEqual(joinedBody.success, true);
  assert.strictEqual(joinedBody.joined, true);
  assert.strictEqual(joinedBody.staticSync.releaseVersion, "rel-a");

  const other = jobService.createExternalJob("static-release-reconcile", { version: "rel-b" }, { lockGroup: "release-heavy" });
  jobService.startJob(other.id, { workerPid: process.pid });
  const closed = await run("rel-c");
  assert.notStrictEqual(closed.code, 0);
  const closedBody = JSON.parse(closed.stderr);
  assert.strictEqual(closedBody.code, "JOB_ALREADY_RUNNING");
  const jobs = jobService.listJobs(20).filter((job) => job.type === "static-release-reconcile" && job.input && job.input.version === "rel-c");
  assert.strictEqual(jobs.length, 0);
  console.log("reconcile static release wait PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
