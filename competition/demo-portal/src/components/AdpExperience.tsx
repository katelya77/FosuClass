import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  Square,
  Wrench,
} from "lucide-react";

import {
  ADP_CHAT_API_URL,
  ADP_DIAGNOSTICS_STORAGE_KEY,
  getPersistentConversationId,
  resolveAdpConfig,
  type AdpFrameConfig,
} from "../lib/adp";
import {
  consumeSseBuffer,
  INITIAL_ADP_EXECUTION,
  parseAdpEvent,
  reduceAdpExecution,
  type AdpExecutionState,
  type AdpWidgetPayload,
} from "../lib/adp-stream";
import { cn } from "../lib/cn";
import { AdpWidget, type AdpWidgetAction } from "./AdpWidget";

interface AdpExperienceProps {
  config?: AdpFrameConfig;
  className?: string;
  initialPrompt?: string;
  showHeader?: boolean;
}

interface ChatTurn {
  id: string;
  question?: string;
  answer: string;
  widget?: AdpWidgetPayload;
}

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

const QUICK_PROMPTS = [
  "未来四周教师负载最高的是谁？",
  "检查 Top1 未来四周的跨校区赶场风险。",
  "帮教师005、006、014找第1周周四上午的共同空闲，并推荐容量不少于120座的教室。",
];

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

export function AdpExperience({
  config,
  className,
  initialPrompt = QUICK_PROMPTS[0],
  showHeader = true,
}: AdpExperienceProps): React.ReactElement {
  const cfg = config ?? resolveAdpConfig();
  const conversationId = useMemo(() => getPersistentConversationId(), []);
  const [input, setInput] = useState(initialPrompt);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [execution, setExecution] = useState<AdpExecutionState>(INITIAL_ADP_EXECUTION);
  const [widgetRendered, setWidgetRendered] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingExecutionRef = useRef<AdpExecutionState | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitExecution = useCallback(
    (next: AdpExecutionState) => {
      setExecution(next);
      saveDiagnostics(buildDiagnostics(next, conversationId, widgetRendered));
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
    },
    [conversationId, widgetRendered],
  );

  const updateExecution = useCallback(
    (next: AdpExecutionState, immediate = false) => {
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
    },
    [commitExecution],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    },
    [],
  );

  const runRequest = useCallback(
    async (payload: { message?: string; widgetAction?: AdpWidgetAction }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setWidgetRendered(false);
      const turnId = crypto.randomUUID();
      setTurns((current) => [
        ...current,
        { id: turnId, question: payload.message, answer: "" },
      ]);

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
          const detail = (await response.json().catch(() => null)) as { message?: string } | null;
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
        }
        updateExecution(currentState, true);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [conversationId, updateExecution],
  );

  const submit = () => {
    const message = input.trim();
    if (!message || execution.status === "connecting" || execution.status === "streaming") return;
    setInput("");
    void runRequest({ message });
  };

  const onWidgetAction = (action: AdpWidgetAction) => {
    if (execution.status === "connecting" || execution.status === "streaming") return;
    void runRequest({ widgetAction: action });
  };

  const isRunning = execution.status === "connecting" || execution.status === "streaming";
  const lastAgent = execution.agentNames.at(-1);
  const childAgent = execution.agentNames.find((name) => name !== execution.agentNames[0]);
  const lastTool = execution.toolNames.at(-1);
  const rail = [
    { label: "用户", active: turns.length > 0, icon: ArrowUp },
    { label: "小序·主协调", active: execution.agentNames.length > 0, icon: Bot },
    { label: childAgent || "领域 Agent", active: execution.agentNames.length > 1, icon: Bot },
    { label: "CampusTools", active: execution.toolNames.length > 0, icon: Wrench },
    { label: "Verified Result", active: Boolean(execution.widget) || execution.status === "completed", icon: ShieldCheck },
  ];

  return (
    <section className={cn("native-adp liquid-glass flex min-h-0 flex-col overflow-hidden rounded-[28px]", className)}>
      {showHeader && (
        <header className="native-adp__header">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn("native-adp__live", isRunning && "animate-pulse")} />
              <p className="text-sm font-semibold text-ink">Native ADP API · 真实对话</p>
            </div>
            <p className="mt-1 text-[11px] text-mute">密钥仅存在服务端 · 官方 SSE 事件直达</p>
          </div>
          <div className="flex items-center gap-2">
            <a href="#/adp-diagnostics" className="glass-button px-3 py-1.5 text-xs">诊断</a>
            <a className="glass-button px-3 py-1.5 text-xs" href={cfg.externalWebimUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={13} /> 官方体验
            </a>
          </div>
        </header>
      )}

      <div className="native-adp__rail" aria-label="真实执行轨">
        {rail.map(({ label, active, icon: Icon }, index) => (
          <div key={`${label}-${index}`} className={cn("native-adp__rail-item", active && "is-active")}>
            <span><Icon size={13} /></span><small>{label}</small>
          </div>
        ))}
      </div>

      <div className="native-adp__conversation">
        {turns.length === 0 ? (
          <div className="native-adp__empty">
            <img src="/branding/platform-logo.png" alt="小序" />
            <div><p>问一句，看到真实 Multi-Agent 怎么做</p><span>生成模型负责理解任务，CampusTools 负责事实。</span></div>
          </div>
        ) : (
          turns.map((turn, index) => {
            const isLatest = index === turns.length - 1;
            return (
              <div key={turn.id} className="native-adp__turn">
                {turn.question && <div className="native-adp__question">{turn.question}</div>}
                <div className="native-adp__answer">
                  <div className="native-adp__answer-meta">
                    <img src="/branding/platform-logo.png" alt="" />
                    <strong>{isLatest ? lastAgent || "小序" : "小序"}</strong>
                    {isLatest && lastTool && <span>{lastTool.split("/").at(-1)}</span>}
                  </div>
                  {turn.answer ? <p>{turn.answer}</p> : isLatest && isRunning ? (
                    <div className="flex items-center gap-2 text-sm text-mute"><LoaderCircle size={15} className="animate-spin" />正在执行真实任务…</div>
                  ) : isLatest && execution.error ? <p className="text-brand-deep">{execution.error}</p> : null}
                  {turn.widget && (
                    <div className="native-adp__widget">
                      <div className="native-adp__widget-label"><CheckCircle2 size={14} /> 官方 ADP Widget</div>
                      <AdpWidget widget={turn.widget} disabled={isRunning} onAction={onWidgetAction} onRendered={() => {
                        setWidgetRendered(true);
                        saveDiagnostics(buildDiagnostics(execution, conversationId, true));
                      }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <footer className="native-adp__composer">
        <div className="native-adp__quick-prompts">
          {QUICK_PROMPTS.map((prompt, index) => <button key={prompt} onClick={() => setInput(prompt)} disabled={isRunning}>{index + 1}. {prompt}</button>)}
        </div>
        <div className="native-adp__input-row">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
          }} placeholder="向小序提问…" rows={2} disabled={isRunning} />
          {isRunning ? (
            <button className="native-adp__send" onClick={() => abortRef.current?.abort()} aria-label="停止生成"><Square size={15} /></button>
          ) : (
            <button className="native-adp__send" onClick={submit} disabled={!input.trim()} aria-label="发送"><ArrowUp size={18} /></button>
          )}
        </div>
      </footer>
    </section>
  );
}
