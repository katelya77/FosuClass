import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const endpoint = process.argv[2] || "https://adp.gaoxiaobang.com/adp/v2/chat";
const prompt = process.argv[3] || "未来四周教师负载最高的是谁？";
const isPortalEndpoint = /\/api\/adp\/chat(?:\?|$)/.test(endpoint);
const varsPath = new URL("../.dev.vars", import.meta.url);
const vars = isPortalEndpoint ? "" : readFileSync(varsPath, "utf8");
const appKey = vars
  .split(/\r?\n/)
  .find((line) => line.startsWith("ADP_APP_KEY="))
  ?.slice("ADP_APP_KEY=".length)
  .trim();

if (!isPortalEndpoint && !appKey) throw new Error("ADP_APP_KEY is missing from .dev.vars");

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 180_000);
const conversationId = randomUUID();
const requestId = randomUUID();

const summary = {
  endpoint,
  requestId,
  conversationId,
  status: null,
  contentType: null,
  eventCount: 0,
  eventTypes: [],
  topLevelKeys: [],
  agents: [],
  subAgentFlags: [],
  tools: [],
  taskNames: [],
  procedures: [],
  widgets: [],
  eventShapes: {},
  errors: [],
};

function addUnique(target, value) {
  if (value !== undefined && value !== null && value !== "" && !target.includes(value)) {
    target.push(value);
  }
}

function inspectEvent(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((item) => inspectEvent(item, depth + 1));
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (depth === 0) addUnique(summary.topLevelKeys, key);
    if (["Event", "event", "Type", "type"].includes(key) && typeof item === "string") {
      addUnique(summary.eventTypes, item);
    }
    if (key === "AgentName" && typeof item === "string") addUnique(summary.agents, item);
    if (key === "IsSubAgent" && typeof item === "boolean") {
      addUnique(summary.subAgentFlags, item);
    }
    if (
      ["ToolName", "PluginName", "tool_name", "plugin_name"].includes(key) &&
      typeof item === "string"
    ) {
      addUnique(summary.tools, item);
    }
    if (key === "Tasks" && Array.isArray(item)) {
      for (const task of item) {
        if (!task || typeof task !== "object") continue;
        addUnique(
          summary.taskNames,
          [task.Name, task.Title, task.Status].filter(Boolean).join(" | "),
        );
      }
    }
    if (key === "Procedures" && Array.isArray(item)) {
      for (const procedure of item) {
        if (!procedure || typeof procedure !== "object") continue;
        addUnique(
          summary.procedures,
          [procedure.Name, procedure.Title, procedure.Status].filter(Boolean).join(" | "),
        );
      }
    }
    if (key === "Widget" && item && typeof item === "object") {
      summary.widgets.push({
        hasView: Boolean(item.View),
        widgetId: item.WidgetId || null,
        widgetRunId: item.WidgetRunId || null,
      });
    }
    if (key === "Error" && item) {
      addUnique(
        summary.errors,
        typeof item === "string" ? item : JSON.stringify(item).slice(0, 300),
      );
    }
    inspectEvent(item, depth + 1);
  }
}

function parseFrame(frame) {
  let eventName = "";
  const dataLines = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (eventName) addUnique(summary.eventTypes, eventName);
  if (!dataLines.length) return;

  summary.eventCount += 1;
  if (dataLines.join("\n").trim() === "[DONE]") return;
  try {
    const parsed = JSON.parse(dataLines.join("\n"));
    const type = parsed?.Type || parsed?.type || eventName || "unknown";
    if (["tool_call", "task_execution", "reply", "message.done"].includes(type)) {
      const paths = [];
      const collectShape = (value, prefix = "", depth = 0) => {
        if (!value || typeof value !== "object" || depth > 5) return;
        for (const [key, item] of Object.entries(value)) {
          const path = prefix ? `${prefix}.${key}` : key;
          addUnique(paths, path);
          if (item && typeof item === "object") collectShape(item, path, depth + 1);
        }
      };
      collectShape(parsed);
      summary.eventShapes[type] ||= [];
      paths.forEach((path) => addUnique(summary.eventShapes[type], path));
    }
    inspectEvent(parsed);
  } catch {
    addUnique(summary.errors, "non-json-sse-data");
  }
}

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(
      isPortalEndpoint
        ? { conversationId, message: prompt }
        : {
            RequestId: requestId,
            ConversationId: conversationId,
            AppKey: appKey,
            Contents: [{ Type: "text", Text: prompt }],
            VisitorId: "final-cut-smoke",
            Incremental: true,
            EnableMultiIntent: true,
            Stream: "enable",
          },
    ),
    signal: controller.signal,
  });

  summary.status = response.status;
  summary.contentType = response.headers.get("content-type");

  if (!response.ok || !response.body) {
    const errorText = (await response.text()).replaceAll(appKey || "<missing>", "<redacted>").slice(0, 800);
    summary.errors.push(errorText || `HTTP ${response.status}`);
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
      frames.forEach(parseFrame);
    }
    if (buffer.trim()) parseFrame(buffer);
  }
} catch (error) {
  summary.errors.push(error?.name === "AbortError" ? "timeout-180s" : String(error));
} finally {
  clearTimeout(timeout);
}

console.log(JSON.stringify(summary, null, 2));

const passed =
  summary.status === 200 &&
  summary.contentType?.toLowerCase().includes("text/event-stream") &&
  summary.eventCount > 0 &&
  summary.errors.length === 0;
if (!passed) process.exitCode = 1;
