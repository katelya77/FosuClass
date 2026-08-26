import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4174";
const OUT = process.env.QA_OUT
  ? path.resolve(process.env.QA_OUT)
  : path.resolve(process.cwd(), "../final-delivery/qa/submission-lock/4174");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

const issues = [];
for (const [width, height] of [[2559, 1418], [1920, 1080], [1440, 900], [1366, 768]]) {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/adp/chat")) apiCalls.push(request.url());
  });
  page.on("pageerror", (error) => issues.push(`${width}x${height} pageerror: ${error.message}`));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/#/experience`, { waitUntil: "networkidle2", timeout: 30000 });
  const initialGeometry = await page.evaluate(() => {
    const conversation = document.querySelector(".native-adp__conversation");
    const guide = document.querySelector(".experience-guide");
    return {
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      conversationClientHeight: conversation?.clientHeight ?? 0,
      conversationScrollHeight: conversation?.scrollHeight ?? 0,
      guideClientHeight: guide?.clientHeight ?? 0,
      guideScrollHeight: guide?.scrollHeight ?? 0,
    };
  });
  if (initialGeometry.documentHeight > initialGeometry.viewportHeight + 1) {
    issues.push(`${width}x${height} initial-vertical-overflow ${JSON.stringify(initialGeometry)}`);
  }
  if (initialGeometry.documentWidth > initialGeometry.viewportWidth + 1) {
    issues.push(`${width}x${height} initial-horizontal-overflow ${JSON.stringify(initialGeometry)}`);
  }
  if (initialGeometry.conversationScrollHeight > initialGeometry.conversationClientHeight + 1) {
    issues.push(`${width}x${height} initial-conversation-scrollbar ${JSON.stringify(initialGeometry)}`);
  }
  if (initialGeometry.guideScrollHeight > initialGeometry.guideClientHeight + 1) {
    issues.push(`${width}x${height} capability-library-clipped ${JSON.stringify(initialGeometry)}`);
  }
  await page.screenshot({ path: path.join(OUT, `4174-all-capabilities-${width}x${height}.png`) });
  await page.goto(`${BASE}/#/experience/query`, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes("这次想解决什么") && document.body.innerText.includes("想知道教师025未来四周的排课情况"));
  const heroGeometry = await page.evaluate(() => {
    const conversation = document.querySelector(".native-adp__conversation");
    const guide = document.querySelector(".experience-guide");
    return {
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      conversationClientHeight: conversation?.clientHeight ?? 0,
      conversationScrollHeight: conversation?.scrollHeight ?? 0,
      guideClientHeight: guide?.clientHeight ?? 0,
      guideScrollHeight: guide?.scrollHeight ?? 0,
    };
  });
  if (heroGeometry.documentHeight > heroGeometry.viewportHeight + 1) {
    issues.push(`${width}x${height} hero-initial-vertical-overflow ${JSON.stringify(heroGeometry)}`);
  }
  if (heroGeometry.conversationScrollHeight > heroGeometry.conversationClientHeight + 1) {
    issues.push(`${width}x${height} hero-initial-conversation-scrollbar ${JSON.stringify(heroGeometry)}`);
  }
  if (heroGeometry.guideScrollHeight > heroGeometry.guideClientHeight + 1) {
    issues.push(`${width}x${height} hero-guide-clipped ${JSON.stringify(heroGeometry)}`);
  }
  await page.screenshot({ path: path.join(OUT, `4174-query-compact-${width}x${height}.png`) });
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

{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/#/cases`, { waitUntil: "networkidle2", timeout: 30000 });
  const routeBefore = await page.evaluate(() => location.hash);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "比赛演示模式");
    if (!(button instanceof HTMLButtonElement)) throw new Error("competition demo button not found");
    button.click();
  });
  await page.waitForSelector('[role="dialog"][aria-label="比赛演示模式"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="跳到算"]')?.getAttribute("aria-current") === "step", {
    timeout: 5000,
  });
  await page.waitForFunction(() => document.body.innerText.includes("自动汇总负载，定位最忙的教师与潜在风险"), {
    timeout: 3000,
  });
  await new Promise((resolve) => setTimeout(resolve, 550));
  const demoState = await page.evaluate(() => ({
    routeAfter: location.hash,
    bodyOverflow: document.body.style.overflow,
    currentStep: document.querySelector('[aria-current="step"]')?.getAttribute("aria-label"),
  }));
  if (demoState.routeAfter !== routeBefore) issues.push(`guided-demo replaced route: ${JSON.stringify(demoState)}`);
  if (demoState.bodyOverflow !== "hidden") issues.push(`guided-demo background not locked: ${JSON.stringify(demoState)}`);
  if (demoState.currentStep !== "跳到算") issues.push(`guided-demo did not advance: ${JSON.stringify(demoState)}`);
  await page.screenshot({ path: path.join(OUT, "4174-guided-demo-step-2-1440x900.png") });
  await page.click('[aria-label="关闭比赛演示"]');
  await page.waitForFunction(() => document.body.style.overflow !== "hidden");
  await page.close();
}

await browser.close();
if (issues.length) {
  console.error([...new Set(issues)].join("\n"));
  process.exitCode = 1;
} else {
  console.log("4174 SUBMISSION LOCK QA CLEAN: initial viewport locked, capability library visible, guided demo advances, replay labelled, zero replay API calls");
}
