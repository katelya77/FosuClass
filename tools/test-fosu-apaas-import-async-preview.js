const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const importerPath = path.join(__dirname, "..", "server", "src", "services", "fosuApaasImporter.js");
const servicePath = path.join(__dirname, "..", "server", "src", "services", "fosuApaasImportService.js");
const sessionStorePath = path.join(__dirname, "..", "server", "src", "services", "fosuApaasImportSessionStore.js");
const limiterPath = path.join(__dirname, "..", "server", "src", "services", "fosuApaasImportRateLimiter.js");
const recentStorePath = path.join(__dirname, "..", "server", "src", "services", "fosuApaasRecentImportStore.js");
const tempRecentFile = path.join(__dirname, "..", ".tmp", `test-fosu-apaas-preview-recent-${process.pid}.json`);

let capturedPassword = "";
let importCallCount = 0;

delete require.cache[require.resolve(importerPath)];
require.cache[require.resolve(importerPath)] = {
  id: importerPath,
  filename: importerPath,
  loaded: true,
  exports: {
    importSchedulePreview: async (studentId, password, options = {}) => {
      importCallCount += 1;
      capturedPassword = password;
      await new Promise((resolve) => setTimeout(resolve, 10));
      const arrangement = {
        arrangementId: "arr-auto",
        courseGroupId: "group-auto",
        courseName: "瀛﹀彿棰勮璇剧▼",
        displayCourseName: "瀛﹀彿棰勮璇剧▼",
        weekday: 1,
        sections: [1, 2],
        startSection: 1,
        endSection: 2,
        weeks: [1, 2, 3],
        weekText: "1-3",
        sectionText: "1-2",
        roomName: "C7-101",
        teacherName: "棰勮鏁欏笀",
        importDecision: "auto_include",
        hasCompleteTime: true,
        selectedByDefault: true,
      };
      return {
        profile: {
          studentId,
          studentName: "测试学生",
          className: "测试班级",
        },
        summary: {
          semester: options.semester || "当前学期",
          rawRowCount: 1,
          scheduledCourseCount: 1,
          unscheduledCourseCount: 0,
          conflictCount: 0,
        },
        previewGrid: { week: 1, days: [] },
        buckets: { recommended: [], pending: [], suspected: [] },
        groups: {},
        uiHints: {},
        preview: [],
        courseGroups: [],
        allArrangements: [arrangement],
        defaultSelectedArrangementIds: ["arr-auto"],
        scheduledCourses: [],
        unscheduledCourses: [],
        timing: {
          channel: "oracle",
          fallbackReason: "APAAS_SESSION_UNVERIFIED",
          retryCount: 0,
          loginMs: 1,
          discoverMs: 2,
          fetchRowsMs: 3,
          relayMs: 0,
          rowsCount: 1,
          bytesApprox: 128,
          normalizeMs: 4,
          totalMs: 15,
        },
      };
    },
  },
};
delete require.cache[require.resolve(servicePath)];

const { createPublicKeyChallenge, __resetForTest: resetSessionStore } = require(sessionStorePath);
const { __resetForTest: resetLimiter } = require(limiterPath);
const {
  __resetForTest: resetRecentStore,
  __setStoreFileForTest,
  getRecentImportForSession,
} = require(recentStorePath);
const {
  getStudentSchedulePreviewJobStatus,
  startStudentSchedulePreviewJob,
} = require(servicePath);

function encryptForServer(publicKey, payload) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const encryptedKey = crypto.publicEncrypt({
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, aesKey);
  return {
    encryptedKey: encryptedKey.toString("base64"),
    encryptedPayload: encryptedPayload.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

async function waitForJob(req, jobId) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const status = getStudentSchedulePreviewJobStatus(req, jobId);
    if (status.status === "success" || status.status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("async preview job did not finish");
}

async function run() {
  const oldRateLimit = process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED;
  process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED = "false";
  fs.mkdirSync(path.dirname(tempRecentFile), { recursive: true });
  __setStoreFileForTest(tempRecentFile);
  resetSessionStore();
  resetLimiter();
  resetRecentStore();
  try {
    const challenge = createPublicKeyChallenge({ ttlSeconds: 300 });
    const password = "unit-secret-password";
    const encrypted = encryptForServer(challenge.publicKey, {
      studentId: "202512340303",
      password,
      nonce: challenge.nonce,
      timestamp: Date.now(),
    });
    const req = {
      fosuSession: { openidHash: "owner-hash" },
      clientIpInfo: { effectiveIp: "127.0.0.1" },
      ip: "127.0.0.1",
    };
    const started = startStudentSchedulePreviewJob(req, Object.assign({
      keyId: challenge.keyId,
      semester: "2025-2026-2",
    }, encrypted));
    assert.strictEqual(started.success, true);
    assert.strictEqual(started.status, "pending");
    assert(started.jobId, "start should return jobId");
    assert(!JSON.stringify(started).includes(password), "start payload must not expose password");

    const done = await waitForJob(req, started.jobId);
    assert.strictEqual(done.status, "success", JSON.stringify(done));
    assert(done.importPreviewToken, "success status should include preview token");
    assert.strictEqual(done.timing.channel, "oracle");
    assert.strictEqual(done.timing.fallbackReason, "APAAS_SESSION_UNVERIFIED");
    assert.strictEqual(done.timing.rowsCount, 1);
    assert.strictEqual(done.timing.bytesApprox, 128);
    assert.strictEqual(done.profile.studentId, "202512340303", "preview UI payload should keep full student id");
    assert.strictEqual(done.profile.studentIdMasked, "2025****0303", "preview UI payload should also include masked student id");
    assert(Array.isArray(done.courseGroups), "preview payload should expose courseGroups for grouped UI");
    assert(done.recentImport, "preview success should return recent import metadata before confirm");
    assert.strictEqual(done.recentImport.courseCount, 1);
    const recent = getRecentImportForSession(req.fosuSession);
    assert(recent, "preview success should save recent import for this mini program session");
    assert.strictEqual(recent.courseCount, 1);
    assert(Array.isArray(recent.editablePreview.allArrangements) && recent.editablePreview.allArrangements.length === 1);
    assert.strictEqual(capturedPassword, password);
    assert(!JSON.stringify(done).includes(password), "status payload must not expose password");

    const secondChallenge = createPublicKeyChallenge({ ttlSeconds: 300 });
    const secondEncrypted = encryptForServer(secondChallenge.publicKey, {
      studentId: "202512340303",
      password,
      nonce: secondChallenge.nonce,
      timestamp: Date.now(),
    });
    const reused = startStudentSchedulePreviewJob(req, Object.assign({
      keyId: secondChallenge.keyId,
      semester: "2025-2026-2",
    }, secondEncrypted));
    assert.strictEqual(reused.jobId, started.jobId, "same user/student should reuse recent preview job");
    assert.strictEqual(reused.hitCache, true);
    assert.strictEqual(reused.timing.hitCache, true);
    assert.strictEqual(importCallCount, 1, "cache hit must not call importer again");

    const thirdChallenge = createPublicKeyChallenge({ ttlSeconds: 300 });
    const thirdEncrypted = encryptForServer(thirdChallenge.publicKey, {
      studentId: "202512340303",
      password,
      nonce: thirdChallenge.nonce,
      timestamp: Date.now(),
    });
    const fresh = startStudentSchedulePreviewJob(req, Object.assign({
      keyId: thirdChallenge.keyId,
      semester: "2025-2026-2",
      forceRefresh: true,
    }, thirdEncrypted));
    assert.notStrictEqual(fresh.jobId, started.jobId, "forceRefresh should bypass reusable preview jobs");
    const freshDone = await waitForJob(req, fresh.jobId);
    assert.strictEqual(freshDone.status, "success");
    assert.strictEqual(importCallCount, 2, "forceRefresh should fetch a fresh preview");
  } finally {
    if (oldRateLimit == null) delete process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED;
    else process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED = oldRateLimit;
    resetSessionStore();
    resetLimiter();
    resetRecentStore();
    try { fs.unlinkSync(tempRecentFile); } catch (error) {}
  }
}

run()
  .then(() => {
    console.log("test-fosu-apaas-import-async-preview passed");
  })
  .catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
