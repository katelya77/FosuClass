import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  CirclePlay,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  Square,
  Wrench,
} from "lucide-react";

import { VERIFIED_REPLAY } from "../data/verifiedReplay";
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

type ExperienceMode = "live" | "replay";

const RATE_LIMIT_COOLDOWN_SECONDS = 30;

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

function userFacingError(message: string): string {
  if (/400429|rate\s*limit/i.test(message)) {
    return "当前体验请求较多，ADP 已返回限流；问题已保留，请稍后重试。";
  }
  if (/timed out|timeout|暂未响应|adp_upstream/i.test(message)) {
    return "实时服务连接超时；问题已保留，请稍后重试。";
  }
  return "本次实时任务未完成；问题已保留，请稍后重试。";
}

function isRateLimited(message?: string): boolean {
  return Boolean(message && /400429|rate\s*limit/i.test(message));
}

function VerifiedReplay({ onLive }: { onLive: () => void }): React.ReactElement {
  return (
    <section className="native-adp native-adp--replay liquid-glass flex min-h-0 flex-col overflow-hidden rounded-[28px]" data-experience-mode="verified-replay">
      <header className="native-adp__header">
        <div>
          <div className="flex items-center gap-2">
            <span className="native-adp__replay-dot"><CirclePlay size={12} /></span>
            <p className="text-sm font-semibold text-ink">已核验实录回放</p>
          </div>
          <p className="mt-1 text-[11px] text-mute">真实成功会话证据 · 非实时请求 · 不消耗 ADP 配额</p>
        </div>
        <div className="native-adp__mode-switch" aria-label="体验模式">
          <button type="button" onClick={onLive}>Live ADP</button>
          <button type="button" className="is-active" aria-pressed="true">Verified Replay</button>
        </div>
      </header>

      <div className="native-adp__rail" aria-label="已核验实录执行轨">
        {VERIFIED_REPLAY.steps.map((step) => (
          <div key={step.kind} className="native-adp__rail-item is-active">
            <span>{step.kind === "tool" ? <Wrench size={13} /> : step.kind === "widget" ? <ShieldCheck size={13} /> : step.kind === "user" ? <ArrowUp size={13} /> : <Bot size={13} />}</span>
            <small>{step.label}</small>
          </div>
        ))}
      </div>

      <div className="native-adp__replay-body">
        <div className="native-adp__replay-copy">
          <span className="native-adp__replay-seal">VERIFIED RECORDING · {VERIFIED_REPLAY.capturedAt}</span>
          <p className="native-adp__replay-question">{VERIFIED_REPLAY.question}</p>
          <div className="native-adp__replay-steps">
            {VERIFIED_REPLAY.steps.slice(1).map((step, index) => (
              <div key={step.kind}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>
            ))}
          </div>
          <div className="native-adp__replay-result">
            <CheckCircle2 size={17} />
            <div><strong>{VERIFIED_REPLAY.answer}</strong><small>WidgetId {VERIFIED_REPLAY.widgetId.slice(0, 8)}… · 证据 SHA-256 {VERIFIED_REPLAY.evidenceSha256.slice(0, 12)}…</small></div>
          </div>
        </div>
        <figure className="native-adp__replay-evidence">
          <div className="native-adp__replay-capture-label"><ShieldCheck size={13} /> 真实 ADP Widget 成功画面</div>
          <img src={VERIFIED_REPLAY.image} alt="真实成功会话中由官方 ADP Widget SDK 渲染的已核验教师负载结果卡" />
          <figcaption>截图来自已成功完成的 Native SSE 会话；回放不重新构造 Widget.View。</figcaption>
        </figure>
      </div>
    </section>
  );
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
  const [mode, setMode] = useState<ExperienceMode>("live");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
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

  const beginRateLimitCooldown = useCallback(() => {
    setCooldownRemaining(RATE_LIMIT_COOLDOWN_SECONDS);
    setCooldownUntil(Date.now() + RATE_LIMIT_COOLDOWN_SECONDS * 1000);
  }, []);

  const runRequest = useCallback(
    async (payload: { message?: string; widgetAction?: AdpWidgetAction }) => {
      // Strict single-flight: an in-flight request may only be stopped by the
      // explicit stop control. A second send never replaces or retries it.
      if (abortRef.current) return;
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
        if (currentState.error && payload.message) {
          setInput((current) => current || payload.message || "");
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
          if (payload.message) setInput((current) => current || payload.message || "");
          if (isRateLimited(currentState.error)) beginRateLimitCooldown();
        }
        updateExecution(currentState, true);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [beginRateLimitCooldown, conversationId, updateExecution],
  );

  const submit = () => {
    const message = input.trim();
    if (!message || cooldownRemaining > 0 || abortRef.current || execution.status === "connecting" || execution.status === "streaming") return;
    setInput("");
    void runRequest({ message });
  };

  const onWidgetAction = (action: AdpWidgetAction) => {
    if (cooldownRemaining > 0 || abortRef.current || execution.status === "connecting" || execution.status === "streaming") return;
    void runRequest({ widgetAction: action });
  };

  const isRunning = execution.status === "connecting" || execution.status === "streaming";
  const rateLimited = isRateLimited(execution.error);
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

  if (mode === "replay") {
    return <VerifiedReplay onLive={() => setMode("live")} />;
  }

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
            <div className="native-adp__mode-switch" aria-label="体验模式">
              <button type="button" className="is-active" aria-pressed="true">Live ADP</button>
              <button type="button" onClick={() => setMode("replay")}>Verified Replay</button>
            </div>
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
                  ) : isLatest && execution.error ? (
                    <div className="native-adp__failure">
                      <p className="text-brand-deep">{userFacingError(execution.error)}</p>
                      {rateLimited && (
                        <button type="button" onClick={() => setMode("replay")}><CirclePlay size={14} />一键查看已核验演示</button>
                      )}
                    </div>
                  ) : null}
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
        {cooldownRemaining > 0 && (
          <div className="native-adp__cooldown" role="status">
            <ShieldCheck size={13} /> ADP 限流冷却 {cooldownRemaining}s；不会自动重试，原问题已保留。
          </div>
        )}
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
            <button className="native-adp__send" onClick={submit} disabled={!input.trim() || cooldownRemaining > 0} aria-label="发送"><ArrowUp size={18} /></button>
          )}
        </div>
      </footer>
    </section>
  );
}
