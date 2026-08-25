import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4174";
const OUT = path.resolve(process.cwd(), "../final-delivery/qa/submission-lock/4174");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

const issues = [];
for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768]]) {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/adp/chat")) apiCalls.push(request.url());
  });
  page.on("pageerror", (error) => issues.push(`${width}x${height} pageerror: ${error.message}`));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/#/experience/insight`, { waitUntil: "networkidle2", timeout: 30000 });
  await page.screenshot({ path: path.join(OUT, `4174-live-${width}x${height}.png`) });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Verified Replay");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Verified Replay button not found");
    button.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("已核验实录回放") && document.body.innerText.includes("非实时请求"));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    componentMode: document.querySelector("[data-experience-mode]")?.getAttribute("data-experience-mode"),
  }));
  if (geometry.scrollWidth > geometry.viewport + 1) issues.push(`${width}x${height} horizontal-overflow ${JSON.stringify(geometry)}`);
  if (geometry.componentMode !== "verified-replay") issues.push(`${width}x${height} replay label missing`);
  if (apiCalls.length !== 0) issues.push(`${width}x${height} replay made ${apiCalls.length} API calls`);
  await page.screenshot({ path: path.join(OUT, `4174-verified-replay-${width}x${height}.png`) });
  await page.close();
}

await browser.close();
if (issues.length) {
  console.error([...new Set(issues)].join("\n"));
  process.exitCode = 1;
} else {
  console.log("4174 SUBMISSION LOCK QA CLEAN: replay clearly labelled, zero API calls, no horizontal overflow");
}
