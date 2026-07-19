const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const lockServicePath = path.resolve(__dirname, "../server/src/services/exclusiveFileLockService");

function waitFor(condition, timeoutMs = 5000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("timed out waiting for lock test condition"));
      setTimeout(check, 10);
    };
    check();
  });
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timeout = setTimeout(() => reject(new Error("timed out waiting for lock test child exit")), timeoutMs);
    child.once("error", reject);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function assertCrashedReclaimGuardRecovers(tmp) {
  const targetPath = path.join(tmp, "crashed-reclaimer-target.json");
  const lockPath = `${targetPath}.lock`;
  const guardPath = `${lockPath}.reclaim`;
  const readyPath = path.join(tmp, "crashed-reclaimer-ready");
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 2147483647,
    token: "dead-primary-owner",
    instanceId: "dead-primary-owner",
    processStartIdentity: "dead-primary-owner",
    createdAt: "2020-01-01T00:00:00.000Z",
  }), "utf8");

  const program = `
    const fs = require("fs");
    const path = require("path");
    const originalRename = fs.renameSync;
    fs.renameSync = function(source, destination) {
      if (path.resolve(source) === ${JSON.stringify(path.resolve(lockPath))}) {
        fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");
        const pause = new Int32Array(new SharedArrayBuffer(4));
        while (true) Atomics.wait(pause, 0, 0, 1000);
      }
      return originalRename.apply(this, arguments);
    };
    const { acquireExclusiveFileLock } = require(${JSON.stringify(lockServicePath)});
    acquireExclusiveFileLock(${JSON.stringify(targetPath)}, {
      lockPath: ${JSON.stringify(lockPath)},
      codePrefix: "FOCUSED",
      waitMs: 5000,
      staleMs: 10,
    });
  `;
  const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "pipe"] });
  let childErrors = "";
  child.stderr.on("data", (chunk) => { childErrors += chunk; });
  try {
    await waitFor(() => fs.existsSync(readyPath) && fs.existsSync(guardPath));
    child.kill("SIGKILL");
    await waitForExit(child);
    assert.strictEqual(childErrors, "", `reclaim child emitted stderr: ${childErrors}`);

    const { acquireExclusiveFileLock } = require(lockServicePath);
    const release = acquireExclusiveFileLock(targetPath, {
      lockPath,
      codePrefix: "FOCUSED",
      waitMs: 2000,
      staleMs: 10,
    });
    release();
    assert.strictEqual(fs.existsSync(lockPath), false, "recovered acquisition must release its primary lock");
    assert.strictEqual(fs.existsSync(guardPath), false, "dead reclaim guard must not remain stranded");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(child).catch(() => {});
  }
}

function assertProcessCreationIdentityDistinguishesPidReuse(tmp) {
  const targetPath = path.join(tmp, "pid-reuse-target.json");
  const lockPath = `${targetPath}.lock`;
  const { acquireExclusiveFileLock } = require(lockServicePath);
  const initialRelease = acquireExclusiveFileLock(targetPath, {
    lockPath,
    codePrefix: "FOCUSED_IDENTITY",
    waitMs: 100,
    staleMs: 10,
  });
  const owned = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  initialRelease();

  if (process.platform === "linux" || process.platform === "win32") {
    assert.ok(owned.processStartIdentity, `${process.platform} lock metadata must include a process-creation identity`);
  }

  const liveMetadata = {
    ...owned,
    token: "matching-live-process",
    instanceId: "matching-live-process",
    createdAt: new Date(Date.now() + 1000).toISOString(),
  };
  fs.writeFileSync(lockPath, JSON.stringify(liveMetadata), "utf8");
  assert.throws(
    () => acquireExclusiveFileLock(targetPath, {
      lockPath,
      codePrefix: "FOCUSED_IDENTITY",
      waitMs: 50,
      staleMs: 0,
    }),
    (error) => error && error.code === "FOCUSED_IDENTITY_LOCK_TIMEOUT" && error.statusCode === 503,
    "matching process-creation identity must keep a live owner fenced"
  );
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).token, liveMetadata.token, "matching live owner must remain untouched");

  fs.writeFileSync(lockPath, JSON.stringify({
    ...liveMetadata,
    token: "reused-pid-owner",
    instanceId: "reused-pid-owner",
    processStartIdentity: `${owned.processStartIdentity}-different-process-creation`,
  }), "utf8");
  const reusedPidRelease = acquireExclusiveFileLock(targetPath, {
    lockPath,
    codePrefix: "FOCUSED_IDENTITY",
    waitMs: 2000,
    staleMs: 0,
  });
  reusedPidRelease();
  assert.strictEqual(fs.existsSync(lockPath), false, "identity mismatch must recover a lock left by a reused PID");
}

async function assertForeignWindowsProcessIdentityIntegration(tmp) {
  if (process.platform !== "win32") return;
  const probeTarget = path.join(tmp, "foreign-identity-probe.json");
  const readyPath = path.join(tmp, "foreign-identity-ready.json");
  const stopPath = path.join(tmp, "foreign-identity-stop");
  const program = `
    const fs = require("fs");
    const { acquireExclusiveFileLock } = require(${JSON.stringify(lockServicePath)});
    const lockPath = ${JSON.stringify(`${probeTarget}.lock`)};
    const release = acquireExclusiveFileLock(${JSON.stringify(probeTarget)}, { lockPath, codePrefix: "FOREIGN_PROBE", waitMs: 1000, staleMs: 0 });
    const metadata = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    release();
    fs.writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify(metadata), "utf8");
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(stopPath)})) Atomics.wait(pause, 0, 0, 10);
  `;
  const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "pipe"] });
  let childErrors = "";
  child.stderr.on("data", (chunk) => { childErrors += chunk; });
  const targetPath = path.join(tmp, "foreign-identity-target.json");
  const lockPath = `${targetPath}.lock`;
  const { acquireExclusiveFileLock } = require(lockServicePath);
  try {
    await waitFor(() => fs.existsSync(readyPath));
    const childMetadata = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    assert.strictEqual(childMetadata.pid, child.pid);
    assert.ok(childMetadata.processStartIdentity, "Windows child must publish its process-creation identity");

    const liveMetadata = {
      ...childMetadata,
      token: "foreign-live-owner",
      instanceId: "foreign-live-owner",
      createdAt: new Date(Date.now() - 60000).toISOString(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(liveMetadata), "utf8");
    assert.throws(
      () => acquireExclusiveFileLock(targetPath, {
        lockPath, codePrefix: "FOREIGN_IDENTITY", waitMs: 1200, staleMs: 0,
      }),
      (error) => error && error.code === "FOREIGN_IDENTITY_LOCK_TIMEOUT" && error.statusCode === 503,
      "a foreign live process with matching creation identity must not be reclaimed"
    );
    assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).token, liveMetadata.token);

    fs.writeFileSync(lockPath, JSON.stringify({
      ...liveMetadata,
      token: "foreign-legacy-reused-pid-owner",
      instanceId: "foreign-legacy-reused-pid-owner",
      processStartIdentity: "",
      createdAt: "2000-01-01T00:00:00.000Z",
    }), "utf8");
    assert.throws(
      () => acquireExclusiveFileLock(targetPath, {
        lockPath, codePrefix: "FOREIGN_IDENTITY", waitMs: 600, staleMs: 0,
      }),
      (error) => error && error.code === "FOREIGN_IDENTITY_LOCK_TIMEOUT" && error.statusCode === 503,
      "identity-less legacy metadata must fail closed because wall-clock order cannot prove PID reuse"
    );
    assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).token, "foreign-legacy-reused-pid-owner");

    fs.writeFileSync(lockPath, JSON.stringify({
      ...liveMetadata,
      token: "foreign-reused-pid-owner",
      instanceId: "foreign-reused-pid-owner",
      processStartIdentity: `${childMetadata.processStartIdentity}-different-process-creation`,
    }), "utf8");
    const release = acquireExclusiveFileLock(targetPath, {
      lockPath, codePrefix: "FOREIGN_IDENTITY", waitMs: 2000, staleMs: 0,
    });
    release();
    assert.strictEqual(fs.existsSync(lockPath), false, "foreign live PID with mismatched creation identity must be recognized as reused");
  } finally {
    if (!fs.existsSync(stopPath)) fs.writeFileSync(stopPath, "stop");
    await waitForExit(child).catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    assert.strictEqual(childErrors, "", `foreign identity child emitted stderr: ${childErrors}`);
  }
}

async function assertLiveReclaimGuardCannotBeStolen(tmp) {
  const targetPath = path.join(tmp, "live-reclaimer-target.json");
  const lockPath = `${targetPath}.lock`;
  const guardPath = `${lockPath}.reclaim`;
  const readyPath = path.join(tmp, "live-reclaimer-ready");
  const resumePath = path.join(tmp, "live-reclaimer-resume");
  const ownerReadyPath = path.join(tmp, "live-owner-ready");
  const ownerReleasePath = path.join(tmp, "live-owner-release");
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 2147483647,
    token: "dead-owner-before-live-reclaimer",
    instanceId: "dead-owner-before-live-reclaimer",
    processStartIdentity: "dead-owner-before-live-reclaimer",
    createdAt: "2020-01-01T00:00:00.000Z",
  }), "utf8");

  const program = `
    const fs = require("fs");
    const path = require("path");
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const originalRename = fs.renameSync;
    let paused = false;
    fs.renameSync = function(source, destination) {
      if (!paused && path.resolve(source) === ${JSON.stringify(path.resolve(lockPath))}) {
        paused = true;
        fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");
        while (!fs.existsSync(${JSON.stringify(resumePath)})) Atomics.wait(pause, 0, 0, 10);
      }
      return originalRename.apply(this, arguments);
    };
    const { acquireExclusiveFileLock } = require(${JSON.stringify(lockServicePath)});
    const release = acquireExclusiveFileLock(${JSON.stringify(targetPath)}, {
      lockPath: ${JSON.stringify(lockPath)}, codePrefix: "LIVE_GUARD", waitMs: 5000, staleMs: 0,
    });
    fs.writeFileSync(${JSON.stringify(ownerReadyPath)}, "ready");
    while (!fs.existsSync(${JSON.stringify(ownerReleasePath)})) Atomics.wait(pause, 0, 0, 10);
    release();
  `;
  const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "pipe"] });
  let childErrors = "";
  child.stderr.on("data", (chunk) => { childErrors += chunk; });
  const { acquireExclusiveFileLock } = require(lockServicePath);
  try {
    await waitFor(() => fs.existsSync(readyPath) && fs.existsSync(guardPath));
    assert.throws(
      () => acquireExclusiveFileLock(targetPath, {
        lockPath, codePrefix: "LIVE_GUARD", waitMs: 100, staleMs: 0,
      }),
      (error) => error && error.code === "LIVE_GUARD_LOCK_TIMEOUT" && error.statusCode === 503,
      "a live reclaim guard must not be stolen"
    );
    assert.ok(fs.existsSync(guardPath), "the live child must still own a reclaim ticket");

    fs.writeFileSync(resumePath, "resume");
    await waitFor(() => fs.existsSync(ownerReadyPath));
    const liveOwner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.strictEqual(liveOwner.pid, child.pid, "child must own the replacement primary lock");
    assert.throws(
      () => acquireExclusiveFileLock(targetPath, {
        lockPath, codePrefix: "LIVE_GUARD", waitMs: 100, staleMs: 0,
      }),
      (error) => error && error.code === "LIVE_GUARD_LOCK_TIMEOUT" && error.statusCode === 503,
      "a live replacement primary lock must not be stolen"
    );
    assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).token, liveOwner.token);

    fs.writeFileSync(ownerReleasePath, "release");
    await waitForExit(child);
    assert.strictEqual(childErrors, "", `live reclaimer child emitted stderr: ${childErrors}`);
    const finalRelease = acquireExclusiveFileLock(targetPath, {
      lockPath, codePrefix: "LIVE_GUARD", waitMs: 2000, staleMs: 0,
    });
    finalRelease();
  } finally {
    if (!fs.existsSync(resumePath)) fs.writeFileSync(resumePath, "resume");
    if (!fs.existsSync(ownerReleasePath)) fs.writeFileSync(ownerReleasePath, "release");
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(child).catch(() => {});
  }
}

function assertMalformedGuardFailsClosedThenRecovers(tmp) {
  const targetPath = path.join(tmp, "malformed-guard-target.json");
  const lockPath = `${targetPath}.lock`;
  const guardPath = `${lockPath}.reclaim`;
  const malformedTicketPath = path.join(guardPath, "ticket-000000000000000000000000.json");
  const malformedBytes = "not-json";
  fs.mkdirSync(guardPath, { recursive: true });
  fs.writeFileSync(malformedTicketPath, malformedBytes, "utf8");
  const { acquireExclusiveFileLock } = require(lockServicePath);
  assert.throws(
    () => acquireExclusiveFileLock(targetPath, {
      lockPath, codePrefix: "MALFORMED_GUARD", waitMs: 50, staleMs: 60000,
    }),
    (error) => error && error.code === "MALFORMED_GUARD_LOCK_TIMEOUT" && error.statusCode === 503,
    "fresh malformed guard metadata must fail closed"
  );
  assert.strictEqual(fs.readFileSync(malformedTicketPath, "utf8"), malformedBytes);

  const staleAt = new Date(Date.now() - 120000);
  fs.utimesSync(malformedTicketPath, staleAt, staleAt);
  const release = acquireExclusiveFileLock(targetPath, {
    lockPath, codePrefix: "MALFORMED_GUARD", waitMs: 2000, staleMs: 10,
  });
  release();
  assert.strictEqual(fs.existsSync(guardPath), false, "stale malformed guard ticket must be retired and cleaned");
}

function assertReclaimGuardLinkFailsClosed(tmp) {
  const targetPath = path.join(tmp, "linked-guard-target.json");
  const lockPath = `${targetPath}.lock`;
  const guardPath = `${lockPath}.reclaim`;
  const trapPath = path.join(tmp, "linked-guard-trap");
  fs.mkdirSync(trapPath, { recursive: true });
  fs.symlinkSync(trapPath, guardPath, process.platform === "win32" ? "junction" : "dir");
  const { acquireExclusiveFileLock } = require(lockServicePath);
  assert.throws(
    () => acquireExclusiveFileLock(targetPath, {
      lockPath, codePrefix: "LINKED_GUARD", waitMs: 50, staleMs: 0,
    }),
    (error) => error && error.code === "LINKED_GUARD_LOCK_TIMEOUT" && error.statusCode === 503,
    "a linked reclaim guard must fail closed"
  );
  assert.deepStrictEqual(fs.readdirSync(trapPath), [], "linked guard target must remain untouched");
  assert.strictEqual(fs.existsSync(lockPath), false, "linked guard must prevent primary lock creation");
  assert.ok(fs.lstatSync(guardPath).isSymbolicLink(), "linked guard itself must remain intact");
}

function assertReleaseWarningsAndErrorsRemainExplicit(tmp) {
  const { acquireExclusiveFileLock } = require(lockServicePath);
  const warningTarget = path.join(tmp, "release-warning-target.json");
  const warningLockPath = `${warningTarget}.lock`;
  const warningRelease = acquireExclusiveFileLock(warningTarget, {
    lockPath: warningLockPath, codePrefix: "FOCUSED_RELEASE", waitMs: 100, staleMs: 10,
  });
  const warningBytes = fs.readFileSync(warningLockPath, "utf8");
  fs.writeFileSync(warningLockPath, "x".repeat(warningBytes.length), "utf8");
  assert.deepStrictEqual(warningRelease(), { warning: { code: "FOCUSED_RELEASE_LOCK_RELEASE_FAILED" } }, "unreadable owned metadata must surface a release warning after identity-safe retirement");
  assert.strictEqual(fs.existsSync(warningLockPath), false);

  const errorTarget = path.join(tmp, "release-error-target.json");
  const errorLockPath = `${errorTarget}.lock`;
  const errorRelease = acquireExclusiveFileLock(errorTarget, {
    lockPath: errorLockPath, codePrefix: "FOCUSED_RELEASE", waitMs: 100, staleMs: 10,
  });
  const held = JSON.parse(fs.readFileSync(errorLockPath, "utf8"));
  fs.writeFileSync(errorLockPath, JSON.stringify({ ...held, token: "f".repeat(held.token.length) }), "utf8");
  assert.throws(
    () => errorRelease(),
    (error) => error && error.code === "FOCUSED_RELEASE_LOCK_RELEASE_FAILED" && error.statusCode === 500,
    "changed ownership must remain a hard release error"
  );
  fs.unlinkSync(errorLockPath);
}

function seedDeadPrimary(lockPath, token) {
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 2147483647,
    token,
    instanceId: token,
    processStartIdentity: token,
    createdAt: "2020-01-01T00:00:00.000Z",
  }), "utf8");
}

function isReclaimTicketPath(target) {
  const normalized = String(target).replace(/\\/g, "/");
  return normalized.includes(".lock.reclaim/ticket-");
}

function assertReclaimTicketReleaseFailuresRecover(tmp) {
  const { acquireExclusiveFileLock } = require(lockServicePath);
  const transientTarget = path.join(tmp, "transient-ticket-release.json");
  const transientLockPath = `${transientTarget}.lock`;
  seedDeadPrimary(transientLockPath, "transient-ticket-dead-owner");
  const originalUnlink = fs.unlinkSync;
  let injectedTransientFailure = false;
  fs.unlinkSync = (target, ...args) => {
    if (!injectedTransientFailure && isReclaimTicketPath(target)) {
      injectedTransientFailure = true;
      const error = new Error("injected transient reclaim ticket unlink failure");
      error.code = "EBUSY";
      throw error;
    }
    return originalUnlink(target, ...args);
  };
  let transientRelease;
  try {
    transientRelease = acquireExclusiveFileLock(transientTarget, {
      lockPath: transientLockPath, codePrefix: "TICKET_RELEASE", waitMs: 2000, staleMs: 0,
    });
  } finally {
    fs.unlinkSync = originalUnlink;
  }
  assert.strictEqual(injectedTransientFailure, true);
  transientRelease();
  assert.strictEqual(fs.existsSync(transientLockPath), false, "transient guard release failure must not leak the primary lock");

  const persistentTarget = path.join(tmp, "persistent-ticket-release.json");
  const persistentLockPath = `${persistentTarget}.lock`;
  const persistentGuardPath = `${persistentLockPath}.reclaim`;
  seedDeadPrimary(persistentLockPath, "persistent-ticket-dead-owner");
  const originalRename = fs.renameSync;
  fs.unlinkSync = (target, ...args) => {
    if (isReclaimTicketPath(target)) {
      const error = new Error("injected persistent reclaim ticket unlink failure");
      error.code = "EBUSY";
      throw error;
    }
    return originalUnlink(target, ...args);
  };
  fs.renameSync = (source, destination) => {
    if (isReclaimTicketPath(source)) {
      const error = new Error("injected persistent reclaim ticket rename failure");
      error.code = "EACCES";
      throw error;
    }
    return originalRename(source, destination);
  };
  try {
    assert.throws(
      () => acquireExclusiveFileLock(persistentTarget, {
        lockPath: persistentLockPath, codePrefix: "TICKET_RELEASE", waitMs: 2000, staleMs: 0,
      }),
      (error) => error && error.code === "TICKET_RELEASE_LOCK_RELEASE_FAILED" && error.statusCode === 500,
      "persistent guard release failure must stay explicit"
    );
  } finally {
    fs.unlinkSync = originalUnlink;
    fs.renameSync = originalRename;
  }
  assert.strictEqual(fs.existsSync(persistentLockPath), false, "failed guard release must discard the newly-created primary lock");
  assert.ok(fs.existsSync(persistentGuardPath), "unreleased ticket must remain available for identity-safe recovery");
  const recoveredRelease = acquireExclusiveFileLock(persistentTarget, {
    lockPath: persistentLockPath, codePrefix: "TICKET_RELEASE", waitMs: 2000, staleMs: 60000,
  });
  recoveredRelease();
  assert.strictEqual(fs.existsSync(persistentGuardPath), false, "next acquisition must recover this process's abandoned ticket");
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-exclusive-lock-"));
  try {
    await assertCrashedReclaimGuardRecovers(tmp);
    assertProcessCreationIdentityDistinguishesPidReuse(tmp);
    await assertForeignWindowsProcessIdentityIntegration(tmp);
    await assertLiveReclaimGuardCannotBeStolen(tmp);
    assertMalformedGuardFailsClosedThenRecovers(tmp);
    assertReclaimGuardLinkFailsClosed(tmp);
    assertReleaseWarningsAndErrorsRemainExplicit(tmp);
    assertReclaimTicketReleaseFailuresRecover(tmp);
    console.log("exclusive file lock focused tests passed");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
