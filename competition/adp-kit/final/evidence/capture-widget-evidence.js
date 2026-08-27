#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "..", "..", "..", "server", "node_modules", "playwright-core"));

const HTML = path.join(__dirname, "widget-html");
const OUTPUT = path.join(__dirname, "widget-screenshots");
const BROWSERS = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

async function main() {
  const executablePath = BROWSERS.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error("Chrome or Edge is required to capture Widget evidence");
  fs.mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1 });
    const files = fs.readdirSync(HTML).filter((name) => name.endsWith(".html")).sort();
    for (const file of files) {
      await page.goto(pathToFileURL(path.join(HTML, file)).href, { waitUntil: "load" });
      const geometry = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        titleClientWidth: document.querySelector(".hero h1")?.clientWidth ?? 0,
        titleScrollWidth: document.querySelector(".hero h1")?.scrollWidth ?? 0,
      }));
      if (geometry.scrollWidth > geometry.viewport + 1 || geometry.titleScrollWidth > geometry.titleClientWidth + 1) {
        throw new Error(`${file}: horizontal or title overflow ${JSON.stringify(geometry)}`);
      }
      await page.screenshot({ path: path.join(OUTPUT, file.replace(/\.html$/, ".png")), fullPage: true });
    }
    process.stdout.write(`Final Widget visual screenshots captured: ${files.length}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
