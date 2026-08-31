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

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4174";
const OUT = path.resolve(here, "..", "assets-refresh");
const QA_OUT = path.resolve(here, "..", "site-qa");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(QA_OUT, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
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

async function qaShot(name, ms = 0) {
  await wait(ms);
  const file = path.join(QA_OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("qa", name, "->", file);
}

async function audit(label) {
  const result = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    hasVisibleLogin: /登录|账号|密码/.test(document.body.innerText),
  }));
  return { label, ...result };
}

const audits = [];

async function goto(url) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
}

// 01 首页（新导航 + 定位句 + 三角色入口）
await goto(`${BASE}/#/`);
await shot("portal-home-1920x1080-final.png", 1800);
await qaShot("01-home-1920x1080.png");
audits.push(await audit("home"));

// 02 能力与角色（三类用户优先，内部能力随后）
await goto(`${BASE}/#/capability`);
await shot("portal-capability-1920x1080-final.png", 1800);
await qaShot("02-capability-1920x1080.png");
audits.push(await audit("capability"));

// 03 案例演示：先看全页，再打开学生案例的非实时回放。
await goto(`${BASE}/#/cases`);
await qaShot("03-cases-1920x1080.png", 1800);
audits.push(await audit("cases"));
await page.evaluate(() => {
  const title = Array.from(document.querySelectorAll("h2")).find((item) => item.textContent?.trim() === "学生的一天");
  title?.parentElement?.parentElement?.parentElement?.click();
});
await qaShot("04-replay-1920x1080.png", 2300);
audits.push(await audit("replay"));

// 03 真实体验（Live ADP 待命态，与旧版构图一致）
await goto(`${BASE}/?timeout=2200#/experience/query`);
await shot("portal-experience-1920x1080-final.png", 2600);
await qaShot("05-live-experience-1920x1080.png");
audits.push(await audit("experience"));

// 04 已核验实录回放（点击“已核验回放”，展示结果卡证据）
await goto(`${BASE}/#/experience/query`);
const replayButton = await page
  .waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent.includes("已核验回放"),
      ) ?? null,
    { timeout: 8000 },
  )
  .catch(() => null);
if (replayButton) {
  await replayButton.asElement().click();
  console.log("clicked verified replay");
} else {
  console.error("verified replay button not found");
}
await shot("portal-verified-widget-1920x1080-final.png", 2200);

fs.writeFileSync(path.join(QA_OUT, "portal-qa.json"), JSON.stringify(audits, null, 2), "utf8");

await browser.close();
console.log("PORTAL ASSET CAPTURE DONE");
