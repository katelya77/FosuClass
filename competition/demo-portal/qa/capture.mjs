/**
 * Phase 2.8 Judge Portal visual QA capture.
 * Usage: npm run qa:capture
 * Requires Edge. Does NOT modify the app, ADP runtime, or any source file.
 */
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4174";
const OUT = path.join(process.cwd(), "qa", "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shoot(page, name, ms = 1200) {
  await wait(ms);
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", name, "->", file);
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
  await wait(500);
}

async function newPage(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 500 });
  return page;
}

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

const issues = [];
const bindErrors = (page) => {
  page.on("pageerror", (e) => issues.push("[pageerror] " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") issues.push("[console.error] " + m.text().slice(0, 180));
  });
};

// Desktop page.
const desktop = await newPage(browser, 1920, 1080);
bindErrors(desktop);

// 01-home
await goto(desktop, BASE + "/#/");
await shoot(desktop, "01-home", 1000);

// 02-home-hover: move pointer over first spotlight card to surface the coral light field.
const card = await desktop.$(".spotlight-card");
if (card) {
  const box = await card.boundingBox();
  if (box) {
    await desktop.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.48, { steps: 12 });
    await wait(850);
  }
}
await shoot(desktop, "02-home-hover", 150);

// 03-experience: real ADP workspace. Use a short timeout so it settles into embedded or blocked.
await goto(desktop, BASE + "/?timeout=2200#/experience/query");
await shoot(desktop, "03-experience", 2600);

// 04-quick-demo: open the Guided Demo from a fresh home load.
await goto(desktop, BASE + "/#/");
await wait(250);
const demoButton = await desktop.waitForFunction(
  () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("快速体验")),
  { timeout: 6000 },
).catch(() => null);
if (demoButton) {
  await demoButton.asElement().click();
  await wait(1300);
}
await shoot(desktop, "04-quick-demo", 200);
await desktop.keyboard.press("Escape");
await wait(500);

// 05-cases
await goto(desktop, BASE + "/#/cases");
await desktop.reload({ waitUntil: "networkidle2" }).catch(() => {});
await wait(500);
await shoot(desktop, "05-cases", 1200);

// 06-about
await goto(desktop, BASE + "/#/about");
await desktop.reload({ waitUntil: "networkidle2" }).catch(() => {});
await wait(500);
await shoot(desktop, "06-about", 1200);

await desktop.close();

// Mobile page.
const mobile = await newPage(browser, 390, 844);
bindErrors(mobile);

// 07-mobile-home
await goto(mobile, BASE + "/#/");
await mobile.reload({ waitUntil: "networkidle2" }).catch(() => {});
await wait(500);
await shoot(mobile, "07-mobile-home", 1000);

// 08-mobile-experience: ADP must be the main content, not a tiny frame.
await goto(mobile, BASE + "/?timeout=2200#/experience/query");
await mobile.reload({ waitUntil: "networkidle2" }).catch(() => {});
await wait(500);
await shoot(mobile, "08-mobile-experience", 2600);

await mobile.close();
await browser.close();

console.log(issues.length ? "ISSUES:\n" + [...new Set(issues)].join("\n") : "QA FRAME CLEAN");
