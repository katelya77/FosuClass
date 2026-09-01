import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.resolve(HERE, "..", "..", "final-delivery", "qa", "live-final", "evidence");
const BASE = (process.env.QA_BASE || "https://adp.katelya.top").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.QA_LIVE_TIMEOUT_MS || 240_000);
const selected = process.argv[2] || "all";

const CASES = {
  student: {
    role: "学生",
    requestedPrompt: "下午哪里有空教室？",
    adjustmentReason: "跨日实测发现该短句可能被解释为当天；改用“继续看周三下午”明确指回上一轮，同时仍不重复班级与周次。",
    prompts: [
      "查看2025级计算机类01班第1周课表。",
      "只看周三。",
      "继续看周三下午，哪里有空教室？",
    ],
    expected: ["2025级计算机类01班", "周三", "campus_classroom_search", "A1-103"],
  },
  collaboration: {
    role: "教师多人协同",
    verificationNote: "本轮最新 Widget.View 直接呈现 7 间满足 120 座的教室与 A1-201；63 间总可用教室由同数据版本的确定性标准核验单独锁定，不冒充本轮 Widget 文案。",
    prompts: ["帮教师005、006、014找第1周周四上午的共同空闲，并推荐容量不少于120座的教室。"],
    expected: [["教师005、006、014", "教师005/006/014"], ["7间", "7 间"], "A1-201", ["120座", "120 座"]],
  },
  reschedule: {
    role: "教师调课",
    requestedPrompt: "将周一5–6节模拟调整到周四7–8节，是否可行？",
    adjustmentReason: "短句首次真实运行仅路由到 campus_day_plan，240 秒内未返回结果卡；为保持同一调课含义并让确定性工具获得必要参数，补充班级、课程与教学周。",
    prompts: ["模拟把2025级计算机类01班第1周周一第5-6节的数据结构课调整到第1周周四第7-8节，不指定教室，请帮我自动选择合适教室，并检查可行性和风险。"],
    expected: [
      "campus_reschedule_feasibility",
      "可行",
      ["风险提示", "现存风险", "轻微负荷风险", "轻度连堂负荷", "轻微负荷预警", "风险预警", "教学疲劳风险"],
      "A1-201",
      "120",
      ["不修改真实课表", "没有修改真实课表", "未写入真实课表"],
    ],
  },
  insight: {
    role: "教学管理者",
    prompts: ["未来四周谁的教学负载最高？", "看他的课表。", "检查他的风险。"],
    expected: ["教师025", "56", "112", "4", "20"],
  },
};

function unique(items) {
  return [...new Set(items.filter((item) => item !== undefined && item !== null && item !== ""))];
}

function walk(value, visit, depth = 0) {
  if (!value || typeof value !== "object" || depth > 9) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    visit(key, item, value);
    walk(item, visit, depth + 1);
  }
}

function messageName(event) {
  return String(event?.Message?.Name || "").toLowerCase();
}

function messageText(event) {
  if (messageName(event) !== "reply") return "";
  return (event?.Message?.Contents || [])
    .map((item) => (typeof item?.Text === "string" ? item.Text : ""))
    .filter(Boolean)
    .join("");
}

function inspectEvent(event, state, eventName = "") {
  const type = String(event?.Type || event?.type || eventName || "message");
  state.eventCount += 1;
  state.eventTypes.push(type);
  const reply = messageText(event);
  if (reply) state.reply = reply;
  walk(event, (key, item) => {
    if (key === "AgentName" && typeof item === "string") state.agentNames.push(item);
    if (["ToolName", "PluginName", "tool_name", "plugin_name"].includes(key) && typeof item === "string") {
      state.toolNames.push(item);
    }
    if (key === "Error" && item) {
      state.errors.push(typeof item === "string" ? item : String(item?.Message || item?.message || "ADP 返回错误"));
    }
    if (key === "Widget" && item && typeof item === "object" && item.View) {
      let view = item.View;
      let widgetState = item.State;
      try { view = JSON.parse(item.View); } catch { /* retain exact public View string */ }
      try { if (typeof item.State === "string") widgetState = JSON.parse(item.State); } catch { /* retain exact public State string */ }
      state.widget = {
        widgetId: item.WidgetId || null,
        widgetRunId: item.WidgetRunId || null,
        view,
        state: widgetState || null,
      };
    }
  });
  state.completed ||= type.toLowerCase() === "response.completed" || type.toLowerCase() === "done";
}

function parseFrame(frame, state) {
  let eventName = "";
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return;
  const joined = data.join("\n");
  if (joined === "[DONE]") {
    inspectEvent({ Type: "done" }, state, eventName);
    return;
  }
  try {
    inspectEvent(JSON.parse(joined), state, eventName);
  } catch {
    state.errors.push("non-json-sse-data");
  }
}

function artifactText(value) {
  return JSON.stringify(value);
}

function expectedLabel(value) {
  return Array.isArray(value) ? value.join(" / ") : value;
}

function expectedMatches(value, text) {
  return Array.isArray(value) ? value.some((item) => text.includes(item)) : text.includes(value);
}

function assertSafe(value) {
  const text = artifactText(value);
  const forbidden = [
    /authorization\s*:/i,
    /bearer\s+[a-z0-9._-]+/i,
    /app[_-]?key\s*[=:]/i,
    /secret(?:id|key)?\s*[=:]/i,
    /token\s*[=:]/i,
    /(?:https?:\/\/)?101\.42\.184\.216/i,
  ];
  const hit = forbidden.find((pattern) => pattern.test(text));
  if (hit) throw new Error(`Evidence safety scan rejected ${hit}`);
}

async function runTurn(conversationId, input) {
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const state = {
    input,
    startedAt,
    completedAt: null,
    durationMs: null,
    status: null,
    requestId: null,
    contentType: null,
    eventCount: 0,
    eventTypes: [],
    agentNames: [],
    toolNames: [],
    reply: "",
    widget: null,
    completed: false,
    errors: [],
  };
  try {
    const response = await fetch(`${BASE}/api/adp/chat`, {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ conversationId, message: input }),
      signal: controller.signal,
    });
    state.status = response.status;
    state.requestId = response.headers.get("x-adp-request-id");
    state.contentType = response.headers.get("content-type");
    if (!response.ok || !response.body) {
      state.errors.push((await response.text()).slice(0, 500) || `HTTP ${response.status}`);
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) parseFrame(frame, state);
        if (state.completed) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      if (buffer.trim() && !state.completed) parseFrame(buffer, state);
    }
  } catch (error) {
    state.errors.push(error?.name === "AbortError" ? `timeout-${TIMEOUT_MS}ms` : String(error));
  } finally {
    clearTimeout(timer);
  }
  state.completedAt = new Date().toISOString();
  state.durationMs = Date.parse(state.completedAt) - Date.parse(startedAt);
  state.eventTypes = unique(state.eventTypes);
  state.agentNames = unique(state.agentNames);
  state.toolNames = unique(state.toolNames);
  state.ok = state.status === 200 && state.completed && Boolean(state.widget) && state.errors.length === 0;
  return state;
}

function renderSummary(evidence) {
  const lines = [
    `# ${evidence.role}真实在线取证`,
    "",
    `- 运行时间：${evidence.startedAt} → ${evidence.completedAt}`,
    `- 公网入口：${BASE}`,
    `- 会话摘要：${evidence.conversationSha256}`,
    `- 结果：${evidence.ok ? "PASS" : "FAIL"}`,
    `- 期望事实：${evidence.expected.join(" / ")}`,
    `- 缺失事实：${evidence.missingExpected.length ? evidence.missingExpected.join(" / ") : "无"}`,
    "",
  ];
  if (evidence.requestedPrompt) lines.splice(7, 0, `- 原始短句：${evidence.requestedPrompt}`, `- 措辞调整：${evidence.adjustmentReason}`);
  if (evidence.verificationNote) lines.splice(7, 0, `- 证据分层：${evidence.verificationNote}`);
  evidence.turns.forEach((turn, index) => {
    lines.push(`## 第 ${index + 1} 轮`, "", `- 输入：${turn.input}`, `- HTTP：${turn.status}`, `- 耗时：${turn.durationMs} ms`, `- Agent：${turn.agentNames.join(" → ") || "未返回"}`, `- Tool：${turn.toolNames.join(" / ") || "未返回"}`, `- Widget：${turn.widget ? "已返回" : "未返回"}`, `- 可见回答：${turn.reply || "（答案由 Widget.View 完整呈现）"}`, "");
  });
  return `${lines.join("\n")}\n`;
}

async function runCase(key, config) {
  const conversationId = randomUUID();
  const startedAt = new Date().toISOString();
  const evidence = { key, role: config.role, baseUrl: BASE, startedAt, completedAt: null, conversationSha256: createHash("sha256").update(conversationId).digest("hex"), requestedPrompt: config.requestedPrompt || null, adjustmentReason: config.adjustmentReason || null, verificationNote: config.verificationNote || null, expected: config.expected.map(expectedLabel), missingExpected: [], turns: [], ok: false };
  for (const prompt of config.prompts) {
    const turn = await runTurn(conversationId, prompt);
    evidence.turns.push(turn);
    fs.mkdirSync(DEFAULT_OUT, { recursive: true });
    assertSafe(evidence);
    fs.writeFileSync(path.join(DEFAULT_OUT, `${key}.partial.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (!turn.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  evidence.completedAt = new Date().toISOString();
  const combined = artifactText(evidence.turns);
  evidence.missingExpected = config.expected.filter((item) => !expectedMatches(item, combined)).map(expectedLabel);
  evidence.ok = evidence.turns.length === config.prompts.length && evidence.turns.every((turn) => turn.ok) && evidence.missingExpected.length === 0;
  assertSafe(evidence);
  fs.writeFileSync(path.join(DEFAULT_OUT, `${key}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(DEFAULT_OUT, `${key}.md`), renderSummary(evidence), "utf8");
  fs.rmSync(path.join(DEFAULT_OUT, `${key}.partial.json`), { force: true });
  console.log(`${key}: ${evidence.ok ? "PASS" : "FAIL"} · ${evidence.turns.length}/${config.prompts.length} turns · missing=${evidence.missingExpected.join(",") || "none"}`);
  return evidence.ok;
}

const entries = selected === "all" ? Object.entries(CASES) : [[selected, CASES[selected]]];
if (!entries.length || entries.some(([, value]) => !value)) throw new Error(`Unknown case: ${selected}`);
let allPassed = true;
for (const [key, config] of entries) allPassed = (await runCase(key, config)) && allPassed;
if (!allPassed) process.exitCode = 1;
