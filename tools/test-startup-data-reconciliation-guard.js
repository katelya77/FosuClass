const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-startup-mutation-guard-"));
const dataDir = path.join(root, "data");
const storageDir = path.join(root, "storage");
const lifecyclePath = path.join(storageDir, "release-lifecycle-state.json");
const activePointerPath = path.join(storageDir, "public", "runtime", "active.json");
const termRegistryPath = path.join(storageDir, "term-registry.json");
const lifecycleBytes = '{"sentinel":"lifecycle-must-not-change"}\n';
const activePointerBytes = '{"sentinel":"active-pointer-must-not-change"}\n';

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.dirname(activePointerPath), { recursive: true });
fs.writeFileSync(lifecyclePath, lifecycleBytes);
fs.writeFileSync(activePointerPath, activePointerBytes);

process.env.FOSU_DATA_DIR = dataDir;
process.env.FOSU_STORAGE_DIR = storageDir;
process.env.FOSU_STARTUP_DATA_RECONCILIATION_ENABLED = "false";
process.env.FOSU_MAINTENANCE_ENABLED = "true";
process.env.STATIC_RELEASE_SYNC_ENABLED = "true";
process.env.FOSU_CONFIG_HARD_FAIL = "false";

let server;
async function main() {
  const storageLifecycleService = require("../server/src/services/storageLifecycleService");
  let maintenanceScheduleCalls = 0;
  storageLifecycleService.scheduleMaintenance = () => { maintenanceScheduleCalls += 1; };
  const app = require("../server/src/app");
  server = app.startServer(0);
  if (!server.listening) await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  assert.strictEqual(fs.readFileSync(lifecyclePath, "utf8"), lifecycleBytes, "startup must not reconcile release lifecycle state");
  assert.strictEqual(fs.readFileSync(activePointerPath, "utf8"), activePointerBytes, "startup must not rebuild the Active Pointer");
  assert.strictEqual(fs.existsSync(termRegistryPath), false, "startup must not migrate or activate term state");
  assert.strictEqual(maintenanceScheduleCalls, 0, "startup must not schedule data-deleting maintenance");
  process.stdout.write(`${JSON.stringify({ ok: true, lifecycleUnchanged: true, activePointerUnchanged: true, termRegistryCreated: false, maintenanceScheduled: false }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
