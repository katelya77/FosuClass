import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4174";
const OUT = path.join(process.cwd(), "qa", "phase3.4-final");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});
const viewports = [
  [1920, 1080],
  [1600, 900],
  [1440, 900],
  [1366, 768],
];
const issues = [];

for (const [width, height] of viewports) {
  const name = `portal-record-${width}x${height}`;
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => issues.push(`${name} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`${name} console.error: ${message.text().slice(0, 240)}`);
  });
  await page.goto(`${BASE}/?mode=record#/experience/query`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const findings = await page.evaluate(() => {
    const found = [];
    const root = document.documentElement;
    if (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1) {
      found.push(`viewport-overflow ${root.scrollWidth}x${root.scrollHeight} > ${innerWidth}x${innerHeight}`);
    }
    const recording = document.querySelector("[data-qa-portal-recording]");
    if (!recording) found.push("recording-root-missing");
    const bodyText = document.body.innerText;
    for (const label of ["用户问题", "主协调", "专业 Agent", "CampusTools", "Widget", "真实 ADP 运行"]) {
      if (!bodyText.includes(label)) found.push(`recording-label-missing ${label}`);
    }
    for (const forbidden of ["诊断", "Verified Replay", "Native ADP API", "developer", "debug", "技术状态"]) {
      if (bodyText.toLowerCase().includes(forbidden.toLowerCase())) found.push(`recording-internal-term ${forbidden}`);
    }
    const railItems = [...document.querySelectorAll(".native-adp__rail-item")];
    if (railItems.length !== 5) found.push(`execution-rail-count ${railItems.length}`);
    const rect = (element) => element.getBoundingClientRect();
    const contained = (element) => {
      const box = rect(element);
      return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    };
    for (const selector of [".recording-question", ".native-adp--record", ".native-adp__rail", ".native-adp__composer"]) {
      const element = document.querySelector(selector);
      if (!element) found.push(`recording-element-missing ${selector}`);
      else if (!contained(element)) found.push(`recording-element-clipped ${selector}`);
    }
    for (const element of document.querySelectorAll(".recording-question strong, .native-adp__rail-item small, .native-adp__header p")) {
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
        found.push(`recording-text-clipped ${(element.textContent || "").trim().slice(0, 36)}`);
      }
    }
    return found;
  });

  findings.forEach((finding) => issues.push(`${name} ${finding}`));
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`shot ${name}`);
  await page.close();
}

await browser.close();
if (issues.length) {
  console.error([...new Set(issues)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PORTAL PHASE 3.4 QA CLEAN — ${viewports.length} screenshots`);
}
