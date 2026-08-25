import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4173";
const OUT = path.resolve(process.cwd(), "../final-delivery/qa/submission-lock/4173");
fs.mkdirSync(OUT, { recursive: true });

const clips = [
  ["risk", "risk.summary", 6.8],
  ["collaboration", "collab.verdict", 7.2],
  ["reschedule", "resched.select", 7.0],
  ["insight", "insight.close", 5.6],
];
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});
const issues = [];

for (const [scene, beat, duration] of clips) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => issues.push(`${scene} pageerror: ${error.message}`));
  await page.goto(`${BASE}/?mode=record&data=fixture&scene=${scene}&beat=${beat}&autoplay=1`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const geometry = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    mode: document.querySelector("main.stage")?.getAttribute("data-mode"),
  }));
  if (geometry.scrollWidth > geometry.viewportWidth + 1 || geometry.scrollHeight > geometry.viewportHeight + 1) {
    issues.push(`${scene} overflow: ${JSON.stringify(geometry)}`);
  }
  if (geometry.mode !== "record") issues.push(`${scene} did not enter record mode`);
  await page.screenshot({ path: path.join(OUT, `4173-${scene}-best-${duration.toFixed(1)}s.png`) });
  await page.close();
}

await browser.close();
if (issues.length) {
  console.error([...new Set(issues)].join("\n"));
  process.exitCode = 1;
} else {
  console.log("4173 SUBMISSION LOCK QA CLEAN: four best deep-links, record mode, no overflow");
}
