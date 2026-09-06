import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AdpWidgetAction } from "../components/AdpWidget";
import {
  ADP_CHAT_API_URL,
  ADP_DIAGNOSTICS_STORAGE_KEY,
  getPersistentConversationId,
} from "./adp";
import {
  consumeSseBuffer,
  INITIAL_ADP_EXECUTION,
  parseAdpEvent,
  reduceAdpExecution,
  type AdpExecutionState,
  type AdpWidgetPayload,
} from "./adp-stream";

export const ADP_EXPERIENCE_STORAGE_KEY = "campusflow.adp.experience.v1";

const RATE_LIMIT_COOLDOWN_SECONDS = 30;
const MAX_SNAPSHOT_TURNS = 12;
const MAX_SNAPSHOT_BYTES = 900_000;
const MAX_WIDGET_VIEW_LENGTH = 180_000;
const REFRESH_INTERRUPTED_ERROR = "页面刷新中断了上一项实时任务；可重新发送保留的问题。";

export interface ChatTurn {
  id: string;
  question?: string;
  answer: string;
  widget?: AdpWidgetPayload;
}

export type ExperienceMode = "live" | "replay";

export interface DiagnosticsSnapshot {
  api: "idle" | "connecting" | "ok" | "error";
  sse: "idle" | "connecting" | "streaming" | "completed" | "error";
  conversationId: string;
  eventCount: number;
  eventTypes: string[];
  agentNames: string[];
  subAgentFlags: boolean[];
  toolNames: string[];
  multiAgent: boolean;
  widgetSdk: boolean;
  widgetReceived: boolean;
  widgetRendered: boolean;
  requestId?: string;
  lastError?: string;
  updatedAt: string;
}

interface StoredExperienceSession {
  version: 1;
  input: string;
  inputDirty: boolean;
  turns: ChatTurn[];
  execution: AdpExecutionState;
  mode: ExperienceMode;
  cooldownUntil: number;
  widgetRendered: boolean;
  savedAt: string;
}

interface RestoredExperienceSession extends StoredExperienceSession {
  restored: boolean;
}

interface ExperienceSessionValue {
  conversationId: string;
  input: string;
  turns: ChatTurn[];
  execution: AdpExecutionState;
  mode: ExperienceMode;
  cooldownRemaining: number;
  widgetRendered: boolean;
  isRunning: boolean;
  restored: boolean;
  applySuggestedPrompt: (prompt: string) => void;
  editInput: (value: string) => void;
  replaceInput: (value: string) => void;
  setMode: (mode: ExperienceMode) => void;
  submit: () => void;
  runWidgetAction: (action: AdpWidgetAction) => void;
  stop: () => void;
  markWidgetRendered: () => void;
}

const ExperienceSessionContext = createContext<ExperienceSessionValue | null>(null);

function isRateLimited(message?: string): boolean {
  return Boolean(message && /400429|rate\s*limit/i.test(message));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 80)
    : [];
}

function booleanArray(value: unknown): boolean[] {
  return Array.isArray(value)
    ? value.filter((item): item is boolean => typeof item === "boolean").slice(0, 10)
    : [];
}

function safeWidget(value: unknown): AdpWidgetPayload | undefined {
  const widget = objectValue(value);
  if (!widget) return undefined;
  const widgetId = boundedString(widget.widgetId, 160);
  const widgetRunId = boundedString(widget.widgetRunId, 160);
  const view = boundedString(widget.view, MAX_WIDGET_VIEW_LENGTH + 1);
  if (!widgetId || !widgetRunId || !view || view.length > MAX_WIDGET_VIEW_LENGTH) return undefined;
  return {
    widgetId,
    widgetRunId,
    view,
    state: boundedString(widget.state, 40_000) || undefined,
  };
}

function safeTurn(value: unknown): ChatTurn | null {
  const turn = objectValue(value);
  if (!turn) return null;
  const id = boundedString(turn.id, 160);
  if (!id) return null;
  return {
    id,
    question: boundedString(turn.question, 4_000) || undefined,
    answer: boundedString(turn.answer, 24_000),
    widget: safeWidget(turn.widget),
  };
}

function safeExecution(value: unknown): AdpExecutionState {
  const execution = objectValue(value);
  const allowedStatuses: AdpExecutionState["status"][] = ["idle", "connecting", "streaming", "completed", "error"];
  const status = allowedStatuses.includes(execution?.status as AdpExecutionState["status"])
    ? execution?.status as AdpExecutionState["status"]
    : "idle";
  return {
    status,
    eventCount: typeof execution?.eventCount === "number" && Number.isFinite(execution.eventCount)
      ? Math.max(0, Math.floor(execution.eventCount))
      : 0,
    eventTypes: stringArray(execution?.eventTypes),
    agentNames: stringArray(execution?.agentNames),
    subAgentFlags: booleanArray(execution?.subAgentFlags),
    toolNames: stringArray(execution?.toolNames),
    procedureLabels: stringArray(execution?.procedureLabels),
    taskLabels: stringArray(execution?.taskLabels),
    reply: boundedString(execution?.reply, 24_000),
    widget: safeWidget(execution?.widget),
    requestId: boundedString(execution?.requestId, 200) || undefined,
    error: boundedString(execution?.error, 1_000) || undefined,
  };
}

function loadExperienceSession(storage?: Storage): RestoredExperienceSession | null {
  const target = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  try {
    const raw = target?.getItem(ADP_EXPERIENCE_STORAGE_KEY);
    if (!raw || raw.length > MAX_SNAPSHOT_BYTES) return null;
    const parsed = objectValue(JSON.parse(raw));
    if (!parsed || parsed.version !== 1) return null;
    const turns = (Array.isArray(parsed.turns) ? parsed.turns : [])
      .map(safeTurn)
      .filter((turn): turn is ChatTurn => Boolean(turn))
      .slice(-MAX_SNAPSHOT_TURNS);
    const execution = safeExecution(parsed.execution);
    const wasRunning = execution.status === "connecting" || execution.status === "streaming";
    const lastQuestion = turns.at(-1)?.question || "";
    const restoredExecution: AdpExecutionState = wasRunning
      ? { ...execution, status: "error", error: REFRESH_INTERRUPTED_ERROR, widget: turns.at(-1)?.widget }
      : { ...execution, widget: execution.widget ?? turns.at(-1)?.widget };
    const input = wasRunning
      ? boundedString(parsed.input, 4_000) || lastQuestion
      : boundedString(parsed.input, 4_000);
    return {
      version: 1,
      input,
      inputDirty: wasRunning || parsed.inputDirty === true,
      turns,
      execution: restoredExecution,
      mode: parsed.mode === "replay" ? "replay" : "live",
      cooldownUntil: typeof parsed.cooldownUntil === "number" && Number.isFinite(parsed.cooldownUntil)
        ? Math.max(0, parsed.cooldownUntil)
        : 0,
      widgetRendered: parsed.widgetRendered === true,
      savedAt: boundedString(parsed.savedAt, 80),
      restored: turns.length > 0 || wasRunning,
    };
  } catch {
    try {
      target?.removeItem(ADP_EXPERIENCE_STORAGE_KEY);
    } catch {
      // A damaged or unavailable store must never block the live workspace.
    }
    return null;
  }
}

function compactWidget(widget?: AdpWidgetPayload): AdpWidgetPayload | undefined {
  return safeWidget(widget);
}

function compactTurn(turn: ChatTurn): ChatTurn {
  return {
    id: turn.id.slice(0, 160),
    question: turn.question?.slice(0, 4_000),
    answer: turn.answer.slice(0, 24_000),
    widget: compactWidget(turn.widget),
  };
}

function publicSnapshotError(message?: string): string | undefined {
  if (!message) return undefined;
  if (message === REFRESH_INTERRUPTED_ERROR) return message;
  if (isRateLimited(message)) return "400429 rate limit";
  return "实时任务未完成";
}

function saveExperienceSession(
  state: Omit<StoredExperienceSession, "version" | "savedAt">,
  storage?: Storage,
): void {
  const target = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  try {
    const execution = {
      ...state.execution,
      widget: undefined,
      requestId: undefined,
      error: publicSnapshotError(state.execution.error),
    };
    const snapshot: StoredExperienceSession = {
      ...state,
      version: 1,
      input: state.input.slice(0, 4_000),
      turns: state.turns.slice(-MAX_SNAPSHOT_TURNS).map(compactTurn),
      execution,
      savedAt: new Date().toISOString(),
    };
    let serialized = JSON.stringify(snapshot);
    while (serialized.length > MAX_SNAPSHOT_BYTES && snapshot.turns.length > 1) {
      snapshot.turns.shift();
      serialized = JSON.stringify(snapshot);
    }
    if (serialized.length > MAX_SNAPSHOT_BYTES && snapshot.turns[0]?.widget) {
      snapshot.turns[0] = { ...snapshot.turns[0], widget: undefined };
      serialized = JSON.stringify(snapshot);
    }
    if (serialized.length <= MAX_SNAPSHOT_BYTES) {
      target?.setItem(ADP_EXPERIENCE_STORAGE_KEY, serialized);
    }
  } catch {
    // Session continuity is best effort and must never interrupt a live request.
  }
}

export function saveDiagnostics(snapshot: DiagnosticsSnapshot): void {
  try {
    window.sessionStorage.setItem(ADP_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent("adp-diagnostics", { detail: snapshot }));
  } catch {
    // Diagnostics must never interrupt the real conversation.
  }
}

export function buildDiagnostics(
  state: AdpExecutionState,
  conversationId: string,
  widgetRendered: boolean,
): DiagnosticsSnapshot {
  return {
    api: state.status === "error" ? "error" : state.status === "connecting" ? "connecting" : state.status === "idle" ? "idle" : "ok",
    sse: state.status,
    conversationId,
    eventCount: state.eventCount,
    eventTypes: state.eventTypes,
    agentNames: state.agentNames,
    subAgentFlags: state.subAgentFlags,
    toolNames: state.toolNames,
    multiAgent: state.agentNames.length > 1,
    widgetSdk: typeof customElements !== "undefined" && Boolean(customElements.get("adp-widget")),
    widgetReceived: Boolean(state.widget),
    widgetRendered,
    requestId: state.requestId,
    lastError: state.error,
    updatedAt: new Date().toISOString(),
  };
}

export function ExperienceSessionProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [restoredState] = useState(() => loadExperienceSession());
  const conversationId = useMemo(() => getPersistentConversationId(), []);
  const [input, setInput] = useState(restoredState?.input ?? "");
  const [inputDirty, setInputDirty] = useState(restoredState?.inputDirty ?? false);
  const [turns, setTurns] = useState<ChatTurn[]>(restoredState?.turns ?? []);
  const [execution, setExecution] = useState<AdpExecutionState>(restoredState?.execution ?? INITIAL_ADP_EXECUTION);
  const [mode, setMode] = useState<ExperienceMode>(restoredState?.mode ?? "live");
  const [cooldownUntil, setCooldownUntil] = useState(restoredState?.cooldownUntil ?? 0);
  const [cooldownRemaining, setCooldownRemaining] = useState(() => Math.max(0, Math.ceil(((restoredState?.cooldownUntil ?? 0) - Date.now()) / 1000)));
  const [widgetRendered, setWidgetRendered] = useState(restoredState?.widgetRendered ?? false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingExecutionRef = useRef<AdpExecutionState | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executionRef = useRef(execution);
  const widgetRenderedRef = useRef(widgetRendered);
  const isRunning = execution.status === "connecting" || execution.status === "streaming";

  const commitExecution = useCallback((next: AdpExecutionState) => {
    executionRef.current = next;
    setExecution(next);
    saveDiagnostics(buildDiagnostics(next, conversationId, widgetRenderedRef.current));
    setTurns((current) => {
      if (!current.length) return current;
      const copy = [...current];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = {
        ...last,
        answer: next.reply || last.answer,
        widget: next.widget ?? last.widget,
      };
      return copy;
    });
  }, [conversationId]);

  const updateExecution = useCallback((next: AdpExecutionState, immediate = false) => {
    pendingExecutionRef.current = next;
    if (immediate) {
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
      pendingExecutionRef.current = null;
      commitExecution(next);
      return;
    }
    if (renderTimerRef.current) return;
    renderTimerRef.current = setTimeout(() => {
      renderTimerRef.current = null;
      const pending = pendingExecutionRef.current;
      pendingExecutionRef.current = null;
      if (pending) commitExecution(pending);
    }, 48);
  }, [commitExecution]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
  }, []);

  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownRemaining(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (!remaining) setCooldownUntil(0);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    saveExperienceSession({
      input,
      inputDirty,
      turns,
      execution,
      mode,
      cooldownUntil,
      widgetRendered,
    });
  }, [cooldownUntil, execution, input, inputDirty, mode, turns, widgetRendered]);

  const beginRateLimitCooldown = useCallback(() => {
    setCooldownRemaining(RATE_LIMIT_COOLDOWN_SECONDS);
    setCooldownUntil(Date.now() + RATE_LIMIT_COOLDOWN_SECONDS * 1000);
  }, []);

  const runRequest = useCallback(async (payload: { message?: string; widgetAction?: AdpWidgetAction }) => {
    // The provider outlives route pages. Only an explicit Stop or final App
    // teardown can abort this strict single-flight request.
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    widgetRenderedRef.current = false;
    setWidgetRendered(false);
    const turnId = crypto.randomUUID();
    setTurns((current) => [...current, { id: turnId, question: payload.message, answer: "" }]);

    let currentState: AdpExecutionState = { ...INITIAL_ADP_EXECUTION, status: "connecting" };
    updateExecution(currentState, true);
    try {
      const response = await fetch(ADP_CHAT_API_URL, {
        method: "POST",
        headers: { accept: "text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({ conversationId, ...payload }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(detail?.message || `ADP API ${response.status}`);
      }
      currentState = {
        ...currentState,
        status: "streaming",
        requestId: response.headers.get("x-adp-request-id") || undefined,
      };
      updateExecution(currentState, true);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = consumeSseBuffer(buffer, (event, eventName) => {
          currentState = reduceAdpExecution(currentState, parseAdpEvent(event, eventName));
          updateExecution(currentState);
        });
      }
      buffer += decoder.decode();
      consumeSseBuffer(`${buffer}\n\n`, (event, eventName) => {
        currentState = reduceAdpExecution(currentState, parseAdpEvent(event, eventName));
      });
      if (currentState.status !== "error") currentState = { ...currentState, status: "completed" };
      if (currentState.error && payload.message) {
        setInput((current) => current || payload.message || "");
        setInputDirty(true);
      }
      if (isRateLimited(currentState.error)) beginRateLimitCooldown();
      updateExecution(currentState, true);
    } catch (error) {
      if (controller.signal.aborted) {
        currentState = { ...currentState, status: "completed" };
      } else {
        currentState = {
          ...currentState,
          status: "error",
          error: error instanceof Error ? error.message : "实时对话失败",
        };
        if (payload.message) {
          setInput((current) => current || payload.message || "");
          setInputDirty(true);
        }
        if (isRateLimited(currentState.error)) beginRateLimitCooldown();
      }
      updateExecution(currentState, true);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [beginRateLimitCooldown, conversationId, updateExecution]);

  const applySuggestedPrompt = useCallback((prompt: string) => {
    if (isRunning || inputDirty) return;
    setInput(prompt);
  }, [inputDirty, isRunning]);

  const editInput = useCallback((value: string) => {
    setInput(value);
    setInputDirty(true);
  }, []);

  const replaceInput = useCallback((value: string) => {
    setInput(value);
    setInputDirty(true);
  }, []);

  const submit = useCallback(() => {
    const message = input.trim();
    if (!message || cooldownRemaining > 0 || abortRef.current || isRunning) return;
    setInput("");
    setInputDirty(false);
    void runRequest({ message });
  }, [cooldownRemaining, input, isRunning, runRequest]);

  const runWidgetAction = useCallback((action: AdpWidgetAction) => {
    if (cooldownRemaining > 0 || abortRef.current || isRunning) return;
    void runRequest({ widgetAction: action });
  }, [cooldownRemaining, isRunning, runRequest]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const markWidgetRendered = useCallback(() => {
    widgetRenderedRef.current = true;
    setWidgetRendered(true);
    saveDiagnostics(buildDiagnostics(executionRef.current, conversationId, true));
  }, [conversationId]);

  const value = useMemo<ExperienceSessionValue>(() => ({
    conversationId,
    input,
    turns,
    execution,
    mode,
    cooldownRemaining,
    widgetRendered,
    isRunning,
    restored: restoredState?.restored ?? false,
    applySuggestedPrompt,
    editInput,
    replaceInput,
    setMode,
    submit,
    runWidgetAction,
    stop,
    markWidgetRendered,
  }), [
    applySuggestedPrompt,
    conversationId,
    cooldownRemaining,
    editInput,
    execution,
    input,
    isRunning,
    markWidgetRendered,
    mode,
    replaceInput,
    restoredState?.restored,
    runWidgetAction,
    stop,
    submit,
    turns,
    widgetRendered,
  ]);

  return <ExperienceSessionContext.Provider value={value}>{children}</ExperienceSessionContext.Provider>;
}

export function useExperienceSession(): ExperienceSessionValue {
  const value = useContext(ExperienceSessionContext);
  if (!value) throw new Error("useExperienceSession must be used inside ExperienceSessionProvider");
  return value;
}
