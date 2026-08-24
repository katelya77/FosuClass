import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4175";
const OUT = path.join(process.cwd(), "qa", "phase2.8-final");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

const issues = [];
const shots = [
  ["portal-home-1920x1080", 1920, 1080, "/#/", 1500],
  ["portal-home-1440x900", 1440, 900, "/#/", 1400],
  ["portal-experience-1440x900", 1440, 900, "/#/experience/query", 6500],
  ["portal-cases-1366x768", 1366, 768, "/#/cases", 1400],
  ["portal-home-1024x1366", 1024, 1366, "/#/", 1400],
  ["portal-about-1440x900", 1440, 900, "/#/about", 1400],
  ["portal-home-390x844", 390, 844, "/#/", 1400],
  ["portal-experience-390x844", 390, 844, "/#/experience/reschedule", 6500],
];

for (const [name, width, height, route, settleMs] of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 500 });
  page.on("pageerror", (error) => issues.push(`${name} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`${name} console.error: ${message.text().slice(0, 220)}`);
  });
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  if (geometry.scrollWidth > geometry.viewport + 1 || geometry.bodyScrollWidth > geometry.viewport + 1) {
    issues.push(`${name} horizontal-overflow: ${JSON.stringify(geometry)}`);
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`shot ${name}`);
  await page.close();
}

await browser.close();
if (issues.length) {
  console.error([...new Set(issues)].join("\n"));
  process.exitCode = 1;
} else {
  console.log("PORTAL FINAL QA CLEAN");
}
