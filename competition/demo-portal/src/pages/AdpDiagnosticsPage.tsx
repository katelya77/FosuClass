import { useEffect, useState, type ReactElement } from "react";
import { Activity, ArrowLeft, Bot, CheckCircle2, CircleDashed, Wrench } from "lucide-react";

import type { DiagnosticsSnapshot } from "../components/AdpExperience";
import { ADP_DIAGNOSTICS_STORAGE_KEY, getPersistentConversationId } from "../lib/adp";
import type { Route } from "../lib/router";

interface AdpDiagnosticsPageProps {
  onNavigate: (route: Route) => void;
}

function loadSnapshot(): DiagnosticsSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(ADP_DIAGNOSTICS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DiagnosticsSnapshot) : null;
  } catch {
    return null;
  }
}

function StateMark({ ok, pending = false }: { ok: boolean; pending?: boolean }): ReactElement {
  return ok ? <CheckCircle2 size={18} /> : pending ? <CircleDashed size={18} /> : <Activity size={18} />;
}

export function AdpDiagnosticsPage({ onNavigate }: AdpDiagnosticsPageProps): ReactElement {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(() => loadSnapshot());
  const conversationId = snapshot?.conversationId || getPersistentConversationId();

  useEffect(() => {
    const update = (event: Event) => {
      setSnapshot((event as CustomEvent<DiagnosticsSnapshot>).detail || loadSnapshot());
    };
    window.addEventListener("adp-diagnostics", update);
    return () => window.removeEventListener("adp-diagnostics", update);
  }, []);

  const items = [
    { label: "API", value: snapshot?.api === "ok" ? "200 · Server-side" : snapshot?.api || "未调用", ok: snapshot?.api === "ok" },
    { label: "SSE", value: snapshot?.sse || "未建立", ok: snapshot?.sse === "streaming" || snapshot?.sse === "completed" },
    { label: "Conversation", value: conversationId, ok: Boolean(conversationId) },
    { label: "Multi-Agent", value: snapshot?.multiAgent ? `${snapshot.agentNames.length} 个真实 Agent` : "等待真实事件", ok: Boolean(snapshot?.multiAgent) },
    { label: "Widget SDK", value: snapshot?.widgetSdk ? "官方 Web Component 已加载" : "等待 SDK", ok: Boolean(snapshot?.widgetSdk) },
    { label: "Widget Render", value: snapshot?.widgetRendered ? "widget-rendered" : snapshot?.widgetReceived ? "已收到 View" : "等待 Widget", ok: Boolean(snapshot?.widgetRendered) },
  ];

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-8 sm:px-6">
      <button className="glass-button px-4 py-2 text-sm" onClick={() => onNavigate({ name: "experience" })}>
        <ArrowLeft size={15} /> 返回真实体验
      </button>
      <div className="mt-7 max-w-3xl">
        <span className="text-xs font-bold tracking-[0.24em] text-brand">ADP DIAGNOSTICS</span>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink">只显示真实发生过的状态</h1>
        <p className="mt-3 text-sm leading-relaxed text-body">这里不展示密钥、系统提示或原始 JSON，只汇总 API、SSE、Multi-Agent 与 Widget 的可核查运行元数据。</p>
      </div>

      <section className="diagnostics-grid mt-8">
        {items.map((item) => (
          <article key={item.label} className="diagnostics-card liquid-glass">
            <div className={item.ok ? "is-ok" : "is-pending"}><StateMark ok={item.ok} pending={!snapshot} /></div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className="diagnostics-evidence liquid-glass mt-6">
        <div>
          <Bot size={18} />
          <span>Last Agent</span>
          <strong>{snapshot?.agentNames.at(-1) || "尚未出现"}</strong>
          <small>{snapshot?.subAgentFlags.length ? `IsSubAgent=${snapshot.subAgentFlags.at(-1)}` : "IsSubAgent 字段尚未由当前发布版返回"}</small>
        </div>
        <div>
          <Wrench size={18} />
          <span>Last Tool</span>
          <strong>{snapshot?.toolNames.at(-1)?.split("/").at(-1) || "尚未出现"}</strong>
          <small>{snapshot ? `${snapshot.eventCount} 个 SSE 事件已解析` : "发送一次真实问题后更新"}</small>
        </div>
        <div>
          <Activity size={18} />
          <span>Request</span>
          <strong>{snapshot?.requestId || "尚未建立"}</strong>
          <small>{snapshot?.updatedAt ? new Date(snapshot.updatedAt).toLocaleString("zh-CN") : "本页不会持久化对话正文"}</small>
        </div>
      </section>
    </div>
  );
}
