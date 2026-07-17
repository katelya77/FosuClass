/**
 * Service-level write parity: content domain service mirrors appConfigService results.
 * (HTTP Legacy vs Vue both hit the same handlers → same service.)
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-write-parity-"));
process.env.FOSU_STORAGE_DIR = path.join(tmpRoot, "storage");
fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });

for (const key of Object.keys(require.cache)) {
  if (key.includes("appConfigService") || key.includes(`${path.sep}content${path.sep}service`)) {
    delete require.cache[key];
  }
}

const appConfigService = require("../server/src/services/appConfigService");
const contentService = require("../server/src/modules/content/service");

const viaDomain = contentService.createNotice({ title: "parity-a", content: "x", enabled: true });
const listedDirect = appConfigService.listNotices();
const listedDomain = contentService.listNotices();
assert.strictEqual(listedDirect.length, listedDomain.length);
assert.ok(listedDirect.some((n) => n.id === viaDomain.id));
assert.ok(listedDomain.some((n) => n.id === viaDomain.id));

const updated = contentService.updateNotice(viaDomain.id, { title: "parity-b" }, { expectedVersion: viaDomain.version });
assert.strictEqual(updated.title, "parity-b");
assert.strictEqual(appConfigService.listNotices().find((n) => n.id === viaDomain.id).title, "parity-b");

contentService.deleteNotice(viaDomain.id);
assert.strictEqual(appConfigService.listNotices().some((n) => n.id === viaDomain.id), false);

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Admin write parity tests passed.");
