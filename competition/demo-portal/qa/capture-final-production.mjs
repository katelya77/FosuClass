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
const SELECTED = process.argv[2] || "all";
const MAX_ATTEMPTS = Number(process.env.QA_MAX_ATTEMPTS || (SELECTED === "all" ? 2 : 1));
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
const reportTarget = path.join(OUT, SELECTED === "all" ? "portal-production-qa.json" : `portal-production-qa-${SELECTED}.json`);

function saveReport() {
  report.completedAt = new Date().toISOString();
  report.ok = report.issues.length === 0 && report.consoleErrors.length === 0 && report.pageErrors.length === 0;
  fs.writeFileSync(reportTarget, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

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
  if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()} for ${hash}`);
  await wait(900);
}

async function shot(page, name) {
  const target = path.join(OUT, name);
  await page.screenshot({ path: target, fullPage: false });
  report.screenshots.push({ name, capturedAt: new Date().toISOString() });
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

function requiredLabel(value) {
  return Array.isArray(value) ? value.join(" / ") : value;
}

function requiredMatches(value, text) {
  return Array.isArray(value) ? value.some((item) => text.includes(item)) : text.includes(value);
}

async function renderedText(page) {
  return page.evaluate(() => {
    const chunks = [document.body.innerText || ""];
    const visited = new Set();
    const visit = (root) => {
      if (!root || visited.has(root)) return;
      visited.add(root);
      chunks.push(root.textContent || "");
      for (const element of root.querySelectorAll("*")) if (element.shadowRoot) visit(element.shadowRoot);
    };
    for (const element of document.querySelectorAll("*")) if (element.shadowRoot) visit(element.shadowRoot);
    return chunks.join("\n");
  });
}

async function alignConversation(page, focusText = "", focusFactor = 0.82) {
  await page.evaluate(({ focus, factor }) => {
    const conversation = document.querySelector(".native-adp__conversation");
    const lastTurn = conversation?.querySelector(".native-adp__turn:last-child");
    if (!conversation || !lastTurn) return;
    let target = lastTurn;
    if (focus) {
      const candidates = [];
      const visited = new Set();
      const visit = (root) => {
        if (!root || visited.has(root)) return;
        visited.add(root);
        for (const element of root.querySelectorAll("*")) {
          const text = (element.textContent || "").trim();
          const rect = element.getBoundingClientRect();
          if (text.includes(focus) && rect.width > 0 && rect.height > 0) candidates.push({ element, area: rect.width * rect.height });
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      };
      visit(lastTurn);
      candidates.sort((left, right) => left.area - right.area);
      if (candidates[0]) target = candidates[0].element;
    }
    const conversationRect = conversation.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const desiredTop = conversationRect.top + (focus ? conversationRect.height * factor : 58);
    conversation.scrollTop = Math.max(0, conversation.scrollTop + targetRect.top - desiredTop);
  }, { focus: focusText, factor: focusFactor });
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
  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea[placeholder="向小序提问…"]');
    const button = document.querySelector('button[aria-label="发送"]');
    return Boolean(textarea?.value.trim()) && Boolean(button) && !button.disabled;
  }, { timeout: 10_000, polling: 100 });
  await page.click('button[aria-label="发送"]');
  try {
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
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      turns: document.querySelectorAll(".native-adp__turn").length,
      widgets: document.querySelectorAll(".native-adp__widget").length,
      failures: [...document.querySelectorAll(".native-adp__failure")].map((item) => item.textContent?.trim() || ""),
      running: Boolean(document.querySelector('button[aria-label="停止生成"]')),
      sendDisabled: Boolean(document.querySelector('button[aria-label="发送"]')?.disabled),
    }));
    throw new Error(`Turn ${turnNo} wait failed: ${JSON.stringify(diagnostic)} · ${String(error)}`);
  }
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
  { key: "student", route: "#/experience/query", file: "04-student-live-1920x1080-final.png", file1366: "04-student-live-1366x768-final.png", focus1366: "第1周周三下午校区A空教室查询结果", prompts: ["查看2025级计算机类01班第1周课表。", "只看周三。", "继续看周三下午，哪里有空教室？"], required: ["同一会话", "查看2025级计算机类01班第1周课表", "只看周三", "继续看周三下午，哪里有空教室", "campus_classroom_search", ["空教室查询结果", "空教室", "可用教室"]] },
  { key: "collaboration", route: "#/experience/collaboration", file: "05-collaboration-live-1920x1080-final.png", focusText: "A1-201", prompts: ["帮教师005、006、014找第1周周四上午的共同空闲，并推荐容量不少于120座的教室。"], required: ["campus_group_plan", "A1-201", ["120座", "120 座"], ["7间", "7 间"]] },
  { key: "reschedule", route: "#/experience/reschedule", file: "06-reschedule-live-1920x1080-final.png", file1366: "06-reschedule-live-1366x768-final.png", focus1366: "整体可行", prompts: ["模拟把2025级计算机类01班第1周周一第5-6节的数据结构课调整到第1周周四第7-8节，不指定教室，请帮我自动选择合适教室，并检查可行性和风险。"], required: ["campus_reschedule_feasibility", "A1-201", "120", "可行", ["风险提示", "现存风险", "轻微负荷风险", "轻度连堂负荷", "轻微负荷预警", "风险预警", "教学疲劳风险"], ["不修改真实课表", "没有修改真实课表", "未写入真实课表"]] },
  { key: "insight", route: "#/experience/insight", file: "07-insight-live-1920x1080-final.png", focusText: "仅20分钟", prompts: ["未来四周谁的教学负载最高？", "看他的课表。", "检查他的风险。"], required: ["同一会话", "campus_risk_check", "教师025", "4", "20"] },
];

try {
  if (["all", "static"].includes(SELECTED)) {
    const staticPage = await newPage("static");
    await goto(staticPage, "#/");
    await shot(staticPage, "01-home-1920x1080-final.png");
    let audit = await pageAudit(staticPage, "home-1920x1080");
    if (!audit.text.replace(/\s+/g, "").includes("说一句话，校园教学安排就清楚了")) report.issues.push("home: hero missing");

    await goto(staticPage, "#/capability");
    await shot(staticPage, "02-roles-1920x1080-final.png");
    audit = await pageAudit(staticPage, "roles-1920x1080");
    for (const role of ["学生", "教师", "教学管理者"]) if (!audit.text.includes(role)) report.issues.push(`roles: missing ${role}`);

    await goto(staticPage, "#/cases");
    await shot(staticPage, "03-cases-1920x1080-final.png");
    audit = await pageAudit(staticPage, "cases-1920x1080");
    if (!audit.text.includes("已核验演示回放 · 非实时")) report.issues.push("cases: replay label missing");

    await goto(staticPage, "#/experience/query");
    const replayButton = await staticPage.$$("button");
    for (const button of replayButton) if ((await button.evaluate((item) => item.textContent || "")).includes("已核验回放")) { await button.click(); break; }
    await wait(1000);
    await shot(staticPage, "08-verified-replay-1920x1080-final.png");
    audit = await pageAudit(staticPage, "replay-1920x1080");
    if (!audit.text.includes("非实时请求")) report.issues.push("replay: non-live label missing");
    await staticPage.close();
    saveReport();
  }

  const selectedLiveConfigs = SELECTED === "all" ? liveConfigs : liveConfigs.filter((config) => config.key === SELECTED);
  if (!["all", "static"].includes(SELECTED) && selectedLiveConfigs.length !== 1) throw new Error(`Unknown capture target: ${SELECTED}`);
  for (const config of selectedLiveConfigs) {
    let passed = false;
    const attempts = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !passed; attempt += 1) {
      const page = await newPage(`${config.key}-attempt-${attempt}`);
      try {
        await resetConversation(page, config.route);
        const turns = [];
        for (let index = 0; index < config.prompts.length; index += 1) turns.push(await sendTurn(page, config.prompts[index], index + 1));
        await alignConversation(page, config.focusText);
        await wait(700);
        const text = await renderedText(page);
        const missing = config.required.filter((item) => !requiredMatches(item, text)).map(requiredLabel);
        if (missing.length) throw new Error(`Missing visible facts: ${missing.join(",")}`);
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        await shot(page, config.file);
        await pageAudit(page, `${config.key}-1920x1080`);
        if (config.file1366) {
          await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
          await wait(500);
          await alignConversation(page, config.focus1366 || config.focusText, 0.65);
          await wait(300);
          await shot(page, config.file1366);
          await pageAudit(page, `${config.key}-1366x768`);
        }
        attempts.push({ attempt, ok: true, turns });
        console.log(`${config.key} attempt ${attempt}: PASS`);
        passed = true;
      } catch (error) {
        const diagnostic = await page.evaluate(() => {
          const lastTurn = document.querySelector(".native-adp__turn:last-child");
          return {
            question: lastTurn?.querySelector(".native-adp__question")?.textContent?.trim() || "",
            tool: lastTurn?.querySelector(".native-adp__answer-meta span")?.textContent?.trim() || "",
            widgetText: (() => {
              const widget = lastTurn?.querySelector(".native-adp__widget");
              const rendered = widget?.querySelector("adp-widget");
              const chunks = [widget?.innerText || ""];
              const visited = new Set();
              const visit = (root) => {
                if (!root || visited.has(root)) return;
                visited.add(root);
                chunks.push(root.textContent || "");
                for (const element of root.querySelectorAll("*")) if (element.shadowRoot) visit(element.shadowRoot);
              };
              visit(rendered?.shadowRoot);
              return chunks.filter(Boolean).join("\n").trim().slice(0, 4000);
            })(),
            failure: lastTurn?.querySelector(".native-adp__failure")?.textContent?.trim() || "",
          };
        }).catch(() => ({ question: "", tool: "", widgetText: "", failure: "" }));
        attempts.push({ attempt, ok: false, error: String(error), diagnostic });
        console.log(`${config.key} attempt ${attempt}: FAIL · ${String(error)}`);
        if (attempt < MAX_ATTEMPTS) await wait(35_000);
      } finally {
        await page.close();
      }
      report.liveCases = [{ key: config.key, ok: passed, attempts }];
      saveReport();
    }
    if (!passed) report.issues.push(`${config.key}: live case failed after retries`);
    report.liveCases = [{ key: config.key, ok: passed, attempts }];
    saveReport();
    await wait(3_000);
  }

  if (["all", "static"].includes(SELECTED)) {
    for (const [width, height] of [[1600, 900], [1440, 900], [1366, 768], [390, 844]]) {
      const page = await newPage(`viewport-${width}x${height}`, width, height);
      await goto(page, "#/experience");
      await pageAudit(page, `experience-${width}x${height}`);
      if (width === 390) await shot(page, "09-mobile-experience-390x844-final.png");
      await page.close();
    }
  }
} finally {
  saveReport();
  await browser.close();
}

console.log(`PORTAL PRODUCTION CAPTURE ${report.ok ? "PASS" : "FAIL"} · screenshots=${report.screenshots.length} · issues=${report.issues.length} · console=${report.consoleErrors.length} · page=${report.pageErrors.length}`);
if (!report.ok) process.exitCode = 1;
