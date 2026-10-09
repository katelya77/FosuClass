#!/usr/bin/env node
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), { pathToFileURL } = require("url");
const { launch } = require("./browserRuntime");
async function smoke(chromium = require("../fosu-sync-client/node_modules/playwright").chromium) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-browser-smoke-"));
  const file = path.join(dir, "local.html");
  fs.writeFileSync(file, '<!doctype html><title>Collector local smoke</title><p id="proof">local-only</p><script>document.getElementById("proof").textContent="rendered"</script>');
  let browser, context;
  try {
    browser = await launch(chromium);
    context = await browser.newContext();
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href);
    if (await page.title() !== "Collector local smoke" || await page.locator("#proof").innerText() !== "rendered") throw new Error("LOCAL_RENDER_FAILED");
    await page.close();
    await context.close(); context = null;
    await browser.close(); browser = null;
    return { browserLifecycle: "PASS", rendering: "PASS", schoolRequests: 0 };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
if (require.main === module) smoke().then(value => console.log(JSON.stringify(value))).catch(() => { console.error("BROWSER_LIFECYCLE_FAILED"); process.exitCode = 1; });
module.exports = { smoke };
