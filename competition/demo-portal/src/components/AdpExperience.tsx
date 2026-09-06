import { useEffect } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  CirclePlay,
  LoaderCircle,
  ShieldCheck,
  Square,
  Wrench,
} from "lucide-react";

import { VERIFIED_REPLAY } from "../data/verifiedReplay";
import { cn } from "../lib/cn";
import { useExperienceSession } from "../lib/experience-session";
import { AdpWidget, type AdpWidgetAction } from "./AdpWidget";

interface AdpExperienceProps {
  className?: string;
  initialPrompt?: string;
  showHeader?: boolean;
  recordMode?: boolean;
}

const QUICK_PROMPTS = [
  { role: "学生", prompt: "查看2025级计算机类01班第1周课表。" },
  { role: "教师", prompt: "帮教师005、006、014找第1周周四上午的共同空闲，并推荐容量不少于120座的教室。" },
  { role: "教学管理", prompt: "未来四周谁的教学负载最高？" },
];

function userFacingError(message: string): string {
  if (/页面刷新中断/.test(message)) return message;
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
          <button type="button" onClick={onLive}>实时体验</button>
          <button type="button" className="is-active" aria-pressed="true">已核验回放</button>
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
          <span className="native-adp__replay-seal">已核验实录 · {VERIFIED_REPLAY.capturedAt}</span>
          <p className="native-adp__replay-question">{VERIFIED_REPLAY.question}</p>
          <div className="native-adp__replay-steps">
            {VERIFIED_REPLAY.steps.slice(1).map((step, index) => (
              <div key={step.kind}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>
            ))}
          </div>
          <div className="native-adp__replay-result">
            <CheckCircle2 size={17} />
            <div><strong>{VERIFIED_REPLAY.answer}</strong><small>结果卡编号 {VERIFIED_REPLAY.widgetId.slice(0, 8)}… · 核验摘要 {VERIFIED_REPLAY.evidenceSha256.slice(0, 12)}…</small></div>
          </div>
        </div>
        <figure className="native-adp__replay-evidence">
          <div className="native-adp__replay-capture-label"><ShieldCheck size={13} /> 真实结果卡成功画面</div>
          <img src={VERIFIED_REPLAY.image} alt="真实成功会话中渲染的已核验教师负载结果卡" />
          <figcaption>截图来自已经成功完成的真实会话；回放不会重新计算或伪造结果。</figcaption>
        </figure>
      </div>
    </section>
  );
}

export function AdpExperience({
  className,
  initialPrompt = QUICK_PROMPTS[0].prompt,
  showHeader = true,
  recordMode = false,
}: AdpExperienceProps): React.ReactElement {
  const session = useExperienceSession();
  const {
    input,
    turns,
    execution,
    mode,
    cooldownRemaining,
    isRunning,
    restored,
    applySuggestedPrompt,
    editInput,
    replaceInput,
    setMode,
    submit,
    runWidgetAction,
    stop,
    markWidgetRendered,
  } = session;

  useEffect(() => {
    applySuggestedPrompt(initialPrompt);
  }, [applySuggestedPrompt, initialPrompt, isRunning]);

  const onWidgetAction = (action: AdpWidgetAction) => runWidgetAction(action);
  const rateLimited = isRateLimited(execution.error);
  const lastAgent = execution.agentNames.at(-1);
  const childAgent = execution.agentNames.find((name) => name !== execution.agentNames[0]);
  const lastTool = execution.toolNames.at(-1);
  const rail = [
    { label: recordMode ? "用户问题" : "用户", active: turns.length > 0, icon: ArrowUp },
    { label: recordMode ? "主协调" : "小序·主协调", active: execution.agentNames.length > 0, icon: Bot },
    { label: recordMode ? "专业智能体" : childAgent || "专业智能体", active: execution.agentNames.length > 1, icon: Bot },
    { label: "CampusTools", active: execution.toolNames.length > 0, icon: Wrench },
    { label: recordMode ? "结果卡" : "已核验结果", active: Boolean(execution.widget) || execution.status === "completed", icon: ShieldCheck },
  ];

  if (mode === "replay" && !recordMode) {
    return <VerifiedReplay onLive={() => setMode("live")} />;
  }

  return (
    <section className={cn("native-adp liquid-glass flex min-h-0 flex-col overflow-hidden rounded-[28px]", recordMode && "native-adp--record", className)} data-record-mode={recordMode ? "true" : "false"}>
      {showHeader && (
        <header className="native-adp__header">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn("native-adp__live", isRunning && "animate-pulse")} />
              <p className="text-sm font-semibold text-ink">{recordMode ? "真实智能体运行" : "真实智能体对话"}</p>
            </div>
            <p className="mt-1 text-[11px] text-mute">{recordMode ? "问题、协作、工具与结果依次到达" : restored ? "已恢复本次会话 · 执行过程实时返回" : "访问凭证仅保存在服务端 · 执行过程实时返回"}</p>
          </div>
          {!recordMode && <div className="native-adp__header-actions flex items-center gap-2">
            <div className="native-adp__mode-switch" aria-label="体验模式">
              <button type="button" className="is-active" aria-pressed="true">实时体验</button>
              <button type="button" onClick={() => setMode("replay")}>已核验回放</button>
            </div>
          </div>}
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
        {turns.length > 1 && (
          <div className="native-adp__context-proof" aria-label="同一会话连续追问轨迹">
            <strong>同一会话</strong>
            {turns.map((turn, index) => (
              <span key={turn.id} title={turn.question}>
                <b>{index + 1}</b>
                {turn.question || "结果卡操作"}
                {turn.widget && <CheckCircle2 size={12} aria-label="已返回结果卡" />}
              </span>
            ))}
          </div>
        )}
        {turns.length === 0 ? (
          <div className="native-adp__empty">
            <img src="/branding/platform-logo.png" alt="小序" />
            <div><p>{recordMode ? "发送问题，观看真实协作过程" : "问一句，看小序怎样理解、计算并核验"}</p><span>模型负责理解任务，CampusTools 负责计算事实。</span></div>
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
                    {isLatest && lastTool && !recordMode && <span>{lastTool.split("/").at(-1)}</span>}
                  </div>
                  {turn.answer ? <p>{turn.answer}</p> : isLatest && isRunning ? (
                    <div className="flex items-center gap-2 text-sm text-mute"><LoaderCircle size={15} className="animate-spin" />正在执行真实任务…</div>
                  ) : isLatest && execution.error ? (
                    <div className="native-adp__failure">
                      <p className="text-brand-deep">{userFacingError(execution.error)}</p>
                      {rateLimited && (
                        !recordMode && <button type="button" onClick={() => setMode("replay")}><CirclePlay size={14} />一键查看已核验演示</button>
                      )}
                    </div>
                  ) : null}
                  {turn.widget && (
                    <div className="native-adp__widget">
                      <div className="native-adp__widget-label"><CheckCircle2 size={14} /> {recordMode ? "已核验结果" : "官方结果卡"}</div>
                      <AdpWidget widget={turn.widget} disabled={isRunning} onAction={onWidgetAction} onRendered={markWidgetRendered} />
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
        {!recordMode && <div className="native-adp__quick-prompts">
          {QUICK_PROMPTS.map(({ role, prompt }) => (
            <button key={role} aria-label={`Quick Start · ${role}`} onClick={() => replaceInput(prompt)} disabled={isRunning}>
              <strong>{role}</strong><span>{prompt}</span>
            </button>
          ))}
        </div>}
        <div className="native-adp__input-row">
          <textarea value={input} onChange={(event) => editInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
          }} placeholder="向小序提问…" rows={2} disabled={isRunning} />
          {isRunning ? (
            <button className="native-adp__send" onClick={stop} aria-label="停止生成"><Square size={15} /></button>
          ) : (
            <button className="native-adp__send" onClick={submit} disabled={!input.trim() || cooldownRemaining > 0} aria-label="发送"><ArrowUp size={18} /></button>
          )}
        </div>
      </footer>
    </section>
  );
}
