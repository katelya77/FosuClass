export interface AdpWidgetPayload {
  widgetId: string;
  widgetRunId: string;
  view: string;
  state?: string;
}

export interface AdpEventFacts {
  type: string;
  agentNames: string[];
  subAgentFlags: boolean[];
  toolNames: string[];
  procedureLabels: string[];
  taskLabels: string[];
  replyDelta: string;
  replyText: string;
  widget?: AdpWidgetPayload;
  completed: boolean;
  error?: string;
}

export interface AdpExecutionState {
  status: "idle" | "connecting" | "streaming" | "completed" | "error";
  eventCount: number;
  eventTypes: string[];
  agentNames: string[];
  subAgentFlags: boolean[];
  toolNames: string[];
  procedureLabels: string[];
  taskLabels: string[];
  reply: string;
  widget?: AdpWidgetPayload;
  requestId?: string;
  error?: string;
}

export const INITIAL_ADP_EXECUTION: AdpExecutionState = {
  status: "idle",
  eventCount: 0,
  eventTypes: [],
  agentNames: [],
  subAgentFlags: [],
  toolNames: [],
  procedureLabels: [],
  taskLabels: [],
  reply: "",
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function walk(value: unknown, visit: (key: string, item: unknown, parent: unknown) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    visit(key, item, value);
    walk(item, visit);
  }
}

function labelsFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = record(item);
      if (!entry) return "";
      return [entry.Name, entry.Title, entry.Status]
        .map(stringValue)
        .filter(Boolean)
        .join(" · ");
    })
    .filter(Boolean);
}

function readWidget(value: unknown): AdpWidgetPayload | undefined {
  let result: AdpWidgetPayload | undefined;
  walk(value, (key, item) => {
    if (result || key !== "Widget") return;
    const widget = record(item);
    if (!widget) return;
    const widgetId = stringValue(widget.WidgetId);
    const widgetRunId = stringValue(widget.WidgetRunId);
    const view = stringValue(widget.View);
    if (widgetId && widgetRunId && view) {
      result = {
        widgetId,
        widgetRunId,
        view,
        state: stringValue(widget.State) || undefined,
      };
    }
  });
  return result;
}

function messageName(value: unknown): string {
  const root = record(value);
  const message = record(root?.Message);
  return stringValue(message?.Name).toLowerCase();
}

function messageText(value: unknown): string {
  const root = record(value);
  const message = record(root?.Message);
  const contents = Array.isArray(message?.Contents) ? message.Contents : [];
  return contents
    .map((item) => stringValue(record(item)?.Text))
    .filter(Boolean)
    .join("");
}

export function parseAdpEvent(value: unknown, eventName = ""): AdpEventFacts {
  const root = record(value);
  const type = stringValue(root?.Type) || stringValue(root?.type) || eventName || "message";
  const lowerType = type.toLowerCase();
  const name = messageName(value);
  const agentNames: string[] = [];
  const subAgentFlags: boolean[] = [];
  const toolNames: string[] = [];
  const procedureLabels: string[] = [];
  const taskLabels: string[] = [];
  let error = "";

  walk(value, (key, item, parent) => {
    if (key === "AgentName" && typeof item === "string") agentNames.push(item);
    if (key === "IsSubAgent" && typeof item === "boolean") subAgentFlags.push(item);
    if (["ToolName", "PluginName", "tool_name", "plugin_name"].includes(key) && typeof item === "string") {
      toolNames.push(item);
    }
    if (key === "Procedures") procedureLabels.push(...labelsFromArray(item));
    if (key === "Tasks") taskLabels.push(...labelsFromArray(item));
    if (key === "Error") {
      if (typeof item === "string") error = item;
      else {
        const detail = record(item);
        error = stringValue(detail?.Message) || stringValue(detail?.message) || "ADP 返回错误";
      }
    }
    if (key === "Name" && name === "tool_call") {
      const parentRecord = record(parent);
      const candidate = stringValue(parentRecord?.Title) || stringValue(item);
      if (candidate && candidate !== "tool_call") toolNames.push(candidate);
    }
  });

  const isReply = name === "reply" || lowerType === "reply";
  const replyText = isReply ? messageText(value) : "";
  // text.delta does not consistently identify its parent message in this ADP build.
  // Rendering it could expose thought content, so user-facing text is accepted only
  // from a completed Message.Name === "reply" event.
  const replyDelta = "";
  const completed = lowerType === "response.completed" || lowerType === "done";

  return {
    type,
    agentNames: unique(agentNames),
    subAgentFlags: unique(subAgentFlags),
    toolNames: unique(toolNames),
    procedureLabels: unique(procedureLabels),
    taskLabels: unique(taskLabels),
    replyDelta,
    replyText,
    widget: readWidget(value),
    completed,
    error: error || undefined,
  };
}

export function reduceAdpExecution(
  state: AdpExecutionState,
  facts: AdpEventFacts,
): AdpExecutionState {
  const nextReply = facts.replyText || `${state.reply}${facts.replyDelta}`;
  const nextError = facts.error ?? state.error;
  return {
    ...state,
    status: nextError ? "error" : facts.completed ? "completed" : "streaming",
    eventCount: state.eventCount + 1,
    eventTypes: unique([...state.eventTypes, facts.type]),
    agentNames: unique([...state.agentNames, ...facts.agentNames]),
    subAgentFlags: unique([...state.subAgentFlags, ...facts.subAgentFlags]),
    toolNames: unique([...state.toolNames, ...facts.toolNames]),
    procedureLabels: unique([...state.procedureLabels, ...facts.procedureLabels]),
    taskLabels: unique([...state.taskLabels, ...facts.taskLabels]),
    reply: nextReply,
    widget: facts.widget ?? state.widget,
    error: nextError,
  };
}

export function consumeSseBuffer(
  input: string,
  onEvent: (value: unknown, eventName: string) => void,
): string {
  const frames = input.split(/\r?\n\r?\n/);
  const remainder = frames.pop() || "";
  for (const frame of frames) {
    let eventName = "";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      onEvent({ Type: "done" }, eventName || "done");
      continue;
    }
    try {
      onEvent(JSON.parse(data), eventName);
    } catch {
      // Heartbeats and non-JSON comments are intentionally ignored.
    }
  }
  return remainder;
}
