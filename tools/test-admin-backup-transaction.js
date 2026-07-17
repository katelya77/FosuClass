/**
 * Backup restore adapters: feedback dual-file rebuild + atomic notices restore.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-backup-tx-"));
const dataDir = path.join(tmp, "data");
const storageDir = path.join(tmp, "storage");
fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
fs.mkdirSync(storageDir, { recursive: true });

process.env.FOSU_DATA_DIR = dataDir;
process.env.FOSU_STORAGE_DIR = storageDir;

for (const key of Object.keys(require.cache)) {
  if (key.includes("backupService") || key.includes("backupRestore")) {
    delete require.cache[key];
  }
}

const backupService = require("../server/src/services/backupService");

// --- notices ---
const noticesPath = path.join(storageDir, "notices.json");
fs.writeFileSync(noticesPath, JSON.stringify([{ id: "a", title: "live" }], null, 2));
const nb = "notices-20260718-010101.json";
fs.writeFileSync(
  path.join(dataDir, "backups", nb),
  JSON.stringify([{ id: "b", title: "from-backup" }], null, 2)
);

const dry = backupService.restoreBackup(nb, { dryRun: true, confirm: nb });
assert.strictEqual(dry.dryRun, true);
assert.strictEqual(JSON.parse(fs.readFileSync(noticesPath, "utf8"))[0].title, "live");

const restored = backupService.restoreBackup(nb, {
  dryRun: false,
  confirm: nb,
  idempotencyKey: "idemp-notices-1",
});
assert.strictEqual(restored.restored, true);
assert.strictEqual(JSON.parse(fs.readFileSync(noticesPath, "utf8"))[0].title, "from-backup");

// idempotency
const again = backupService.restoreBackup(nb, {
  dryRun: false,
  confirm: nb,
  idempotencyKey: "idemp-notices-1",
});
assert.strictEqual(again.restored, true);

// --- feedback dual file ---
const feedbacksPath = path.join(storageDir, "feedbacks.json");
const jsonlPath = path.join(storageDir, "feedback.jsonl");
fs.writeFileSync(
  feedbacksPath,
  JSON.stringify([{ id: "f1", content: "old", status: "open" }], null, 2)
);
fs.writeFileSync(
  jsonlPath,
  `${JSON.stringify({ id: "f1", content: "old", status: "open" })}\n${JSON.stringify({
    id: "f-later",
    content: "after-backup-row",
    status: "open",
  })}\n`
);

const snap = [
  { id: "f1", content: "snap", status: "resolved" },
  { id: "f2", content: "snap2", status: "open" },
];
const fb = "feedback-20260718-020202.json";
fs.writeFileSync(path.join(dataDir, "backups", fb), JSON.stringify(snap, null, 2));

const fbRestore = backupService.restoreBackup(fb, { dryRun: false, confirm: fb, idempotencyKey: "fb-1" });
assert.strictEqual(fbRestore.restored, true);
const arr = JSON.parse(fs.readFileSync(feedbacksPath, "utf8"));
assert.strictEqual(arr.length, 2);
assert.ok(arr.every((r) => r.id !== "f-later"), "jsonl post-backup rows must not remain");
const lines = fs
  .readFileSync(jsonlPath, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);
assert.strictEqual(lines.length, 2);

// confirm required
let denied = false;
try {
  backupService.restoreBackup(nb, { dryRun: false, confirm: "wrong" });
} catch (e) {
  denied = e.code === "CONFIRM_REQUIRED";
}
assert.ok(denied);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("Admin backup transaction tests passed.");
