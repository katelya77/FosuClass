import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require(path.join(process.cwd(), "..", "demo-portal", "node_modules", "puppeteer-core"));

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4173";
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
const beats = [
  ["opening-entities", "scene=opening&t=1.7&autoplay=0", "opening"],
  ["opening-first-relation", "scene=opening&t=3.1&autoplay=0", "opening"],
  ["opening-network", "scene=opening&t=6.2&autoplay=0", "opening"],
  ["opening-brand", "scene=opening&t=8.4&autoplay=0", "opening"],
  ["risk-schedule", "scene=hero-risk&beat=risk.schedule&autoplay=0", "risk"],
  ["risk-relation", "scene=hero-risk&beat=risk.warning&autoplay=0", "risk"],
  ["risk-result", "scene=hero-risk&beat=risk.summary&autoplay=0", "risk"],
  ["reschedule-result", "scene=hero-reschedule&beat=resched.decision&autoplay=0", "reschedule"],
  ["insight-top1", "scene=hero-insight&beat=insight.close&autoplay=0", "insight"],
  ["reliability-chain", "t=149&autoplay=0", "reliability"],
];

const issues = [];
const unique = (items) => [...new Set(items)];

for (const [width, height] of viewports) {
  for (const [beatName, params, kind] of beats) {
    const name = `${beatName}-${width}x${height}`;
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => issues.push(`${name} pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") issues.push(`${name} console.error: ${message.text().slice(0, 240)}`);
    });
    await page.goto(`${BASE}/?mode=record&data=fixture&${params}`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const findings = await page.evaluate(({ sceneKind, beatName }) => {
      const found = [];
      const root = document.documentElement;
      if (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1) {
        found.push(`viewport-overflow ${root.scrollWidth}x${root.scrollHeight} > ${innerWidth}x${innerHeight}`);
      }
      const rect = (element) => element.getBoundingClientRect();
      const visible = (element) => {
        const style = getComputedStyle(element);
        const box = rect(element);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05 && box.width > 0 && box.height > 0;
      };
      const contained = (element, inset = 0) => {
        const box = rect(element);
        return box.left >= inset - 1 && box.top >= inset - 1 && box.right <= innerWidth - inset + 1 && box.bottom <= innerHeight - inset + 1;
      };
      const overlaps = (a, b) => {
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return x * y > 4;
      };
      const assertNoPairOverlap = (selector, label) => {
        const elements = [...document.querySelectorAll(selector)].filter(visible);
        for (let i = 0; i < elements.length; i += 1) {
          for (let j = i + 1; j < elements.length; j += 1) {
            if (overlaps(rect(elements[i]), rect(elements[j]))) found.push(`${label}-overlap ${i + 1}/${j + 1}`);
          }
        }
      };
      const clipped = (element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
      for (const element of document.querySelectorAll("[data-qa-text]")) {
        if (visible(element) && clipped(element)) found.push(`text-clipping: ${(element.textContent || "").trim().slice(0, 40)}`);
      }
      const bodyText = document.body.innerText;
      if (/Hero Scene|Demo Cue|Runtime Proof|Native ADP API|diagnostics/i.test(bodyText)) found.push("record-mode-internal-terminology");

      if (sceneKind === "opening") {
        const nodes = [...document.querySelectorAll("[data-opening-node]")].filter(visible);
        if (nodes.length !== 6) found.push(`opening-node-count ${nodes.length}`);
        nodes.forEach((node, index) => {
          if (!contained(node, 18)) found.push(`opening-node-out-of-bounds ${index + 1}`);
        });
        const edges = document.querySelectorAll('[data-opening-visible="true"]').length;
        if (edges > 7) found.push(`opening-edge-count ${edges}`);
        if (beatName === "opening-entities" && edges !== 0) found.push(`opening-entities-visible-edges ${edges}`);
        if (beatName === "opening-first-relation" && edges !== 1) found.push(`opening-first-relation-visible-edges ${edges}`);
        if (beatName === "opening-network" && edges !== 5) found.push(`opening-network-visible-edges ${edges}`);
        if (beatName === "opening-brand" && document.querySelectorAll('[data-opening-label-visible="true"]').length !== 0) found.push("opening-brand-visible-labels");
      }

      if (["risk", "reschedule", "insight"].includes(sceneKind)) {
        const proof = document.querySelector("[data-qa-proof-chip]");
        if (!proof || !visible(proof)) {
          found.push("proof-chip-missing");
        } else {
          const box = rect(proof);
          const style = getComputedStyle(proof);
          const right = innerWidth - box.right;
          const bottom = innerHeight - box.bottom;
          if (style.position !== "fixed") found.push(`proof-chip-position ${style.position}`);
          if (right < 27 || right > 37 || bottom < 23 || bottom > 31) found.push(`proof-chip-safe-area right=${right.toFixed(1)} bottom=${bottom.toFixed(1)}`);
        }
      }

      if (sceneKind === "reschedule") {
        const constraints = [...document.querySelectorAll("[data-qa-reschedule-constraints] li")];
        const expected = ["班级时间", "教师时间", "教室占用", "容量", "功能属性", "连续授课"];
        if (constraints.length !== 6) found.push(`reschedule-constraint-count ${constraints.length}`);
        for (const label of expected) {
          if (!constraints.some((item) => item.textContent?.includes(label) && item.textContent?.includes("PASS"))) found.push(`reschedule-constraint-missing ${label}`);
        }
        const warning = document.querySelector("[data-qa-reschedule-warning]");
        const decision = document.querySelector("[data-qa-reschedule-decision]");
        if (!warning?.textContent?.includes("连续 4 节提醒")) found.push("reschedule-warning-missing");
        if (!decision?.textContent?.includes("可行 · 附带提醒")) found.push("reschedule-decision-missing");
        assertNoPairOverlap("[data-qa-reschedule-constraints], [data-qa-reschedule-warning], [data-qa-reschedule-decision]", "reschedule-block");
      }

      if (sceneKind === "risk" && document.querySelector("[data-qa-risk-summary]")) {
        for (const conclusion of ["课程冲突", "转场预警", "最短转场窗口"]) {
          if (!bodyText.includes(conclusion)) found.push(`risk-conclusion-missing ${conclusion}`);
        }
      }
      if (sceneKind === "insight") {
        for (const conclusion of ["教师025", "56", "112", "课程冲突", "转场预警"]) {
          if (!bodyText.includes(conclusion)) found.push(`insight-conclusion-missing ${conclusion}`);
        }
      }
      if (sceneKind === "reliability") {
        assertNoPairOverlap("[data-qa-reliability-node]", "reliability-node");
        assertNoPairOverlap("[data-qa-reliability-proof]", "reliability-proof");
        const chain = document.querySelector("[data-qa-reliability-chain]");
        const proofs = document.querySelector("[data-qa-reliability-proofs]");
        if (chain && proofs && overlaps(rect(chain), rect(proofs))) found.push("reliability-columns-overlap");
        for (const label of ["用户问题", "主协调", "专业 Agent", "CampusTools", "已核验结果", "下一镜：真实 ADP 运行"]) {
          if (!bodyText.includes(label)) found.push(`reliability-label-missing ${label}`);
        }
      }
      for (const selector of ["h1", "h2", "[data-qa-proof-chip]", "[data-qa-reschedule-warning]", "[data-qa-reschedule-decision]"]) {
        document.querySelectorAll(selector).forEach((element) => {
          if (visible(element) && !contained(element)) found.push(`element-out-of-viewport ${selector}`);
        });
      }
      return found;
    }, { sceneKind: kind, beatName });

    findings.forEach((finding) => issues.push(`${name} ${finding}`));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`shot ${name}`);
    await page.close();
  }
}

await browser.close();
if (issues.length) {
  console.error(unique(issues).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`SHOWCASE PHASE 3.4 QA CLEAN — ${viewports.length * beats.length} screenshots`);
}
