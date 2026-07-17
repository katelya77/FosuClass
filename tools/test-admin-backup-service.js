const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-backup-svc-"));
const dataDir = path.join(tmpRoot, "data");
const storageDir = path.join(tmpRoot, "storage");
fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
fs.mkdirSync(storageDir, { recursive: true });

process.env.FOSU_DATA_DIR = dataDir;
process.env.FOSU_STORAGE_DIR = storageDir;

const servicePath = require.resolve("../server/src/services/backupService");
delete require.cache[servicePath];
const backupService = require(servicePath);

const noticesPath = path.join(storageDir, "notices.json");
fs.writeFileSync(noticesPath, JSON.stringify([{ id: "n1", title: "live" }], null, 2));

const backupName = "notices-20260718-120000.json";
const backupPath = path.join(dataDir, "backups", backupName);
fs.writeFileSync(backupPath, JSON.stringify([{ id: "n0", title: "from-backup" }], null, 2));

const list = backupService.listBackups();
assert.ok(list.some((i) => i.filename === backupName));
assert.strictEqual(list.find((i) => i.filename === backupName).restorable, true);

const pre = backupService.preflightRestore(backupName);
assert.strictEqual(pre.ok, true);
assert.strictEqual(pre.parseOk, true);

const dry = backupService.restoreBackup(backupName, { dryRun: true });
assert.strictEqual(dry.dryRun, true);
assert.strictEqual(dry.restored, false);
assert.strictEqual(JSON.parse(fs.readFileSync(noticesPath, "utf8"))[0].title, "live");

const restored = backupService.restoreBackup(backupName, { dryRun: false });
assert.strictEqual(restored.restored, true);
assert.strictEqual(JSON.parse(fs.readFileSync(noticesPath, "utf8"))[0].title, "from-backup");

// safety backup of previous live should exist
const safety = fs.readdirSync(path.join(dataDir, "backups")).filter((f) => f.startsWith("pre-restore-notices-"));
assert.ok(safety.length >= 1);

backupService.deleteBackup(backupName);
assert.ok(!fs.existsSync(backupPath));

// cleanup
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Admin backup service tests passed.");
