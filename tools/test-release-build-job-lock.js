const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-job-lock-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const jobService = require("../server/src/services/jobService");

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-job-lock-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJob(id) {
  for (let index = 0; index < 50; index += 1) {
    const job = jobService.readJob(id);
    if (job && (job.status === "success" || job.status === "failed")) return job;
    await sleep(50);
  }
  throw new Error(`job ${id} did not finish`);
}

async function run() {
  const first = jobService.createSingletonJob("release-pack-rebuild", {}, async () => {
    await sleep(250);
    return { ok: true };
  });
  assert(first.id, "first singleton job should be created");
  assert.throws(() => {
    jobService.createSingletonJob("release-pack-rebuild", {}, async () => ({ ok: true }));
  }, (error) => error.code === "JOB_ALREADY_RUNNING" && error.statusCode === 409);

  const done = await waitJob(first.id);
  assert.strictEqual(done.status, "success");
  const second = jobService.createSingletonJob("release-pack-rebuild", {}, async () => ({ ok: true }));
  assert(second.id, "second job should be allowed after first finishes");
  await waitJob(second.id);
  cleanup();
  console.log("test-release-build-job-lock passed");
}

run().catch((error) => {
  console.error(error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
});
