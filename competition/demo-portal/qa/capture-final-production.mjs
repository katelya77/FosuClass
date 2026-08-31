import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.QA_BASE || "https://adp.katelya.top").replace(/\/$/, "");
const OUT = path.resolve(HERE, "..", "..", "final-delivery", "qa", "live-final", "screenshots");
const CHROME = process.env.QA_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const LIVE_TIMEOUT = Number(process.env.QA_LIVE_TIMEOUT_MS || 300_000);
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--disable-gpu", "--no-sandbox", "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});

const report = {
  baseUrl: BASE,
  startedAt: new Date().toISOString(),
  completedAt: null,
  screenshots: [],
  viewports: [],
  liveCases: [],
  consoleErrors: [],
  pageErrors: [],
  issues: [],
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function watch(page, label) {
  page.on("pageerror", (error) => report.pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(`${label}: ${message.text().slice(0, 400)}`);
  });
}

async function newPage(label, width = 1920, height = 1080) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.setDefaultTimeout(LIVE_TIMEOUT);
  watch(page, label);
  return page;
}

async function goto(page, hash) {
  const response = await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle2", timeout: 60_000 });
  if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status() || "none"} for ${hash}`);
  await wait(900);
}

async function shot(page, name) {
  const target = path.join(OUT, name);
  await page.screenshot({ path: target, fullPage: false });
  report.screenshots.push({ name, path: target, capturedAt: new Date().toISOString() });
}

async function pageAudit(page, label) {
  const value = await page.evaluate(() => ({
    route: location.hash,
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    internalLinks: [...document.querySelectorAll("a")].map((item) => item.href).filter((href) => /^http:\/\//i.test(href)),
    text: document.body.innerText,
  }));
  report.viewports.push({ label, ...value, text: undefined });
  if (value.horizontalOverflow) report.issues.push(`${label}: horizontal overflow ${value.scrollWidth}>${value.width}`);
  if (value.internalLinks.length) report.issues.push(`${label}: internal links ${value.internalLinks.join(",")}`);
  return value;
}

async function resetConversation(page, hash) {
  await goto(page, hash);
  await page.evaluate((conversationId) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("campusflow.adp.conversation.v1", conversationId);
  }, randomUUID());
  await page.reload({ waitUntil: "networkidle2", timeout: 60_000 });
  await wait(900);
}

async function sendTurn(page, prompt, turnNo) {
  await page.waitForSelector('textarea[placeholder="向小序提问…"]');
  await page.$eval('textarea[placeholder="向小序提问…"]', (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, prompt);
  await page.click('button[aria-label="发送"]');
  await page.waitForFunction(
    (expectedTurn) => {
      const turns = [...document.querySelectorAll(".native-adp__turn")];
      if (turns.length < expectedTurn) return false;
      const last = turns[expectedTurn - 1];
      const stopped = !document.querySelector('button[aria-label="停止生成"]');
      return stopped && (Boolean(last.querySelector(".native-adp__widget")) || Boolean(last.querySelector(".native-adp__failure")));
    },
    { timeout: LIVE_TIMEOUT, polling: 500 },
    turnNo,
  );
  const state = await page.evaluate((expectedTurn) => {
    const turn = [...document.querySelectorAll(".native-adp__turn")][expectedTurn - 1];
    return {
      question: turn?.querySelector(".native-adp__question")?.textContent?.trim() || "",
      tool: turn?.querySelector(".native-adp__answer-meta span")?.textContent?.trim() || "",
      hasWidget: Boolean(turn?.querySelector(".native-adp__widget")),
      failure: turn?.querySelector(".native-adp__failure")?.textContent?.trim() || "",
    };
  }, turnNo);
  if (!state.hasWidget) throw new Error(`Turn ${turnNo} did not return Widget.View: ${state.failure || "unknown"}`);
  await wait(1800);
  return state;
}

const liveConfigs = [
  { key: "student", route: "#/experience/query", file: "04-student-live-1920x1080-final.png", file1366: "04-student-live-1366x768-final.png", prompts: ["查看2025级计算机类01班第1周课表。", "只看周三。", "下午哪里有空教室？"], required: ["同一会话", "A1-103", "空间推荐"] },
  { key: "collaboration", route: "#/experience/collaboration", file: "05-collaboration-live-1920x1080-final.png", prompts: ["帮教师005、006、014找第1周周四上午的共同空闲，并推荐容量不少于120座的教室。"], required: ["A1-201", "120", "63", "7"] },
  { key: "reschedule", route: "#/experience/reschedule", file: "06-reschedule-live-1920x1080-final.png", file1366: "06-reschedule-live-1366x768-final.png", prompts: ["模拟把2025级计算机类01班第1周周一第5-6节的数据结构课调整到第1周周四第7-8节，不指定教室，请帮我自动选择合适教室，并检查可行性和风险。"], required: ["可行", "风险提示", "不修改真实课表"] },
  { key: "insight", route: "#/experience/insight", file: "07-insight-live-1920x1080-final.png", prompts: ["未来四周谁的教学负载最高？", "看他的课表。", "检查他的风险。"], required: ["同一会话", "教师025", "4", "20"] },
];

try {
  const staticPage = await newPage("static");
  await goto(staticPage, "#/");
  await shot(staticPage, "01-home-1920x1080-final.png");
  let audit = await pageAudit(staticPage, "home-1920x1080");
  if (!audit.text.includes("说一句话，校园教学安排就清楚了")) report.issues.push("home: hero missing");

  await goto(staticPage, "#/capability");
  await shot(staticPage, "02-roles-1920x1080-final.png");
  audit = await pageAudit(staticPage, "roles-1920x1080");
  for (const role of ["学生", "教师", "教学管理者"]) if (!audit.text.includes(role)) report.issues.push(`roles: missing ${role}`);

  await goto(staticPage, "#/cases");
  await shot(staticPage, "03-cases-1920x1080-final.png");
  audit = await pageAudit(staticPage, "cases-1920x1080");
  if (!audit.text.includes("已核验演示回放 · 非实时")) report.issues.push("cases: replay label missing");

  await goto(staticPage, "#/experience/query");
  await staticPage.click('button[aria-label="体验模式"] button:last-child').catch(async () => {
    const buttons = await staticPage.$$("button");
    for (const button of buttons) if ((await button.evaluate((item) => item.textContent)).includes("已核验回放")) { await button.click(); break; }
  });
  await wait(1000);
  await shot(staticPage, "08-verified-replay-1920x1080-final.png");
  audit = await pageAudit(staticPage, "replay-1920x1080");
  if (!audit.text.includes("非实时请求")) report.issues.push("replay: non-live label missing");
  await staticPage.close();

  for (const config of liveConfigs) {
    let passed = false;
    const attempts = [];
    for (let attempt = 1; attempt <= 2 && !passed; attempt += 1) {
      const page = await newPage(`${config.key}-attempt-${attempt}`);
      try {
        await resetConversation(page, config.route);
        const turns = [];
        for (let index = 0; index < config.prompts.length; index += 1) turns.push(await sendTurn(page, config.prompts[index], index + 1));
        await page.$eval(".native-adp__conversation", (element) => { element.scrollTop = element.scrollHeight; });
        await wait(700);
        const text = await page.evaluate(() => document.body.innerText);
        const missing = config.required.filter((item) => !text.includes(item));
        if (missing.length) throw new Error(`Missing visible facts: ${missing.join(",")}`);
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        await shot(page, config.file);
        await pageAudit(page, `${config.key}-1920x1080`);
        if (config.file1366) {
          await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
          await wait(500);
          await shot(page, config.file1366);
          await pageAudit(page, `${config.key}-1366x768`);
        }
        attempts.push({ attempt, ok: true, turns });
        passed = true;
      } catch (error) {
        attempts.push({ attempt, ok: false, error: String(error) });
        if (attempt < 2) await wait(35_000);
      } finally {
        await page.close();
      }
    }
    report.liveCases.push({ key: config.key, ok: passed, attempts });
    if (!passed) report.issues.push(`${config.key}: live case failed after retries`);
    await wait(3_000);
  }

  for (const [width, height] of [[1600, 900], [1440, 900], [1366, 768], [390, 844]]) {
    const page = await newPage(`viewport-${width}x${height}`, width, height);
    await goto(page, "#/experience");
    await pageAudit(page, `experience-${width}x${height}`);
    if (width === 390) await shot(page, "09-mobile-experience-390x844-final.png");
    await page.close();
  }
} finally {
  report.completedAt = new Date().toISOString();
  report.ok = report.issues.length === 0 && report.consoleErrors.length === 0 && report.pageErrors.length === 0;
  fs.writeFileSync(path.join(OUT, "portal-production-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await browser.close();
}

console.log(`PORTAL PRODUCTION CAPTURE ${report.ok ? "PASS" : "FAIL"} · screenshots=${report.screenshots.length} · issues=${report.issues.length} · console=${report.consoleErrors.length} · page=${report.pageErrors.length}`);
if (!report.ok) process.exitCode = 1;
