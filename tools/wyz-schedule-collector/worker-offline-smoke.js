#!/usr/bin/env node
"use strict";
// Run only in a network-disabled test container. No real Session is mounted.
const fs = require("fs"), os = require("os"), path = require("path");
async function smoke() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-worker-offline-"));
  let browser, context;
  const log = { log: console.log, warn: console.warn, error: console.error };
  try {
    fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ cookies: [], origins: [] }), { mode: 0o600 });
    Object.assign(process.env, { FOSU_COLLECTOR_MODE: "1", FOSU_SYNC_HEADLESS: "1", FOSU_SYNC_DATA_DIR: dir, FOSU_COLLECTOR_SESSION: path.join(dir, "session.json"), FOSU_STORAGE_DIR: path.join(dir, "storage"), FOSU_COLLECTOR_SAMPLE_KIND: "class", FOSU_COLLECTOR_REQUEST_BUDGET: "40" });
    console.log = console.warn = console.error = () => {};
    const sync = require("../fosu-sync-client/sync");
    ({ browser, context } = await sync.initBrowserContext());
    const page = await context.newPage();
    await page.close();
    return { syncImport: "PASS", workerContextLifecycle: "PASS", realSessionMounted: false, network: "DISABLED_BY_CALLER" };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    Object.assign(console, log);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
if (require.main === module) smoke().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(JSON.stringify({ status: "BLOCKED", code: require("./workerReceipt").normalizeCode(error) })); process.exitCode = 1; });
module.exports = { smoke };
