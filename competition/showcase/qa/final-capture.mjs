import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4173";
const OUT = path.join(process.cwd(), "qa", "phase2.8-final");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

const issues = [];
const shots = [
  ["showcase-opening-1920x1080", 1920, 1080, "scene=opening&t=13&autoplay=0", 2800],
  ["showcase-architecture-1920x1080", 1920, 1080, "scene=architecture&autoplay=1", 8200],
  ["showcase-risk-1440x900", 1440, 900, "scene=risk&beat=risk.summary&autoplay=0", 3600],
  ["showcase-reschedule-1920x1080", 1920, 1080, "scene=reschedule&beat=resched.decision&autoplay=0", 3600],
  ["showcase-insight-1366x768", 1366, 768, "scene=insight&beat=insight.risk&autoplay=0", 3600],
  ["showcase-architecture-1024x768", 1024, 768, "scene=architecture&autoplay=1", 8200],
  ["showcase-portrait-390x844", 390, 844, "scene=opening&t=13&autoplay=0", 1800],
];

for (const [name, width, height, params, settleMs] of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 500 });
  page.on("pageerror", (error) => issues.push(`${name} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`${name} console.error: ${message.text().slice(0, 220)}`);
  });
  await page.goto(`${BASE}/?mode=record&data=fixture&${params}`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const geometry = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  if (geometry.scrollWidth > geometry.viewportWidth + 1 || geometry.scrollHeight > geometry.viewportHeight + 1) {
    issues.push(`${name} stage-overflow: ${JSON.stringify(geometry)}`);
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
  console.log("SHOWCASE FINAL QA CLEAN");
}
