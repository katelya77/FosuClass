/**
 * Refresh the four judge-facing portal screenshots used by the final PPT and
 * design book after the review-narrative site restructure.
 *
 * Usage: node capture-portal-assets.mjs   (requires vite preview on 4174)
 * Writes 1920x1080 PNGs into final-delivery/assets-refresh/.
 * Does NOT modify the app, the ADP runtime, or any source file.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const portalRoot = path.resolve(here, "..", "..", "demo-portal");
const require = createRequire(path.join(portalRoot, "package.json"));
const puppeteer = require("puppeteer-core");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4174";
const OUT = path.resolve(here, "..", "assets-refresh");
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1920,1080",
  ],
  defaultViewport: { width: 1920, height: 1080 },
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

async function shot(name, ms) {
  await wait(ms);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", name, "->", file);
}

async function goto(url) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
}

// 01 首页（新导航 + 定位句 + 三角色入口）
await goto(`${BASE}/#/`);
await shot("portal-home-1920x1080-final.png", 1800);

// 02 角色与能力（ROLE_CARDS 三角色卡 + 六项能力）
await goto(`${BASE}/#/capability`);
await shot("portal-capability-1920x1080-final.png", 1800);

// 03 真实体验（Live ADP 待命态，与旧版构图一致）
await goto(`${BASE}/?timeout=2200#/experience/query`);
await shot("portal-experience-1920x1080-final.png", 2600);

// 04 已核验实录回放（点击 Verified Replay，展示 Widget 证据）
await goto(`${BASE}/#/experience/query`);
const replayButton = await page
  .waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Verified Replay"),
      ) ?? null,
    { timeout: 8000 },
  )
  .catch(() => null);
if (replayButton) {
  await replayButton.asElement().click();
  console.log("clicked Verified Replay");
} else {
  console.error("Verified Replay button not found");
}
await shot("portal-verified-widget-1920x1080-final.png", 2200);

await browser.close();
console.log("PORTAL ASSET CAPTURE DONE");
