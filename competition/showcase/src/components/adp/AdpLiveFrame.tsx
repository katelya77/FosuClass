import { useEffect, useRef, useState } from "react";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { resolveAdpConfig, type AdpFrameConfig } from "./config";
import { cn } from "../../lib/cn";

/** 帧状态机：loading → embedded / blocked；external-only 完全不渲染 iframe */
export type AdpFrameState = "loading" | "embedded" | "blocked" | "external-only";

interface AdpLiveFrameProps {
  config?: AdpFrameConfig;
  className?: string;
  /** 强制外开模式（录制时由 OBS 捕获真实 ADP 窗口） */
  forceExternal?: boolean;
  /** 嵌入判定超时（毫秒） */
  timeoutMs?: number;
}

const STATUS_TEXT: Record<AdpFrameState, string> = {
  loading: "正在连接 ADP 真机…",
  embedded: "已内嵌 · 实时运行",
  blocked: "内嵌被浏览器策略阻止",
  "external-only": "外部窗口模式",
};

const DOT_COLOR: Record<AdpFrameState, string> = {
  loading: "var(--brand-secondary)",
  embedded: "var(--success)",
  blocked: "var(--risk)",
  "external-only": "var(--text-faint)",
};

/**
 * ADP Live Frame —— 全应用唯一一层 iframe Adapter。
 * 不绕过任何安全限制：X-Frame-Options / CSP 阻止时降级为
 * 「腾讯 ADP 真机演示」外开卡片，最终录屏用 OBS 捕获真实窗口。
 */
export function AdpLiveFrame({
  config,
  className,
  forceExternal = false,
  timeoutMs = 5000,
}: AdpLiveFrameProps): JSX.Element {
  const cfg = config ?? resolveAdpConfig();
  const [state, setState] = useState<AdpFrameState>(forceExternal ? "external-only" : "loading");
  const loadedRef = useRef(false);

  useEffect(() => {
    if (forceExternal) return;
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) setState("blocked");
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [forceExternal, timeoutMs]);

  const mixedContent =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    cfg.chatUrl.startsWith("http:");

  return (
    <section
      data-state={state}
      className={cn("panel flex min-h-0 flex-col overflow-hidden", className)}
    >
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn("size-2 shrink-0 rounded-full", state === "loading" && "animate-pulse")}
            style={{ background: DOT_COLOR[state] }}
          />
          <div className="min-w-0">
            <p className="t-card-title truncate">腾讯云智能 ADP · 真机</p>
            <p className="t-caption truncate">{STATUS_TEXT[state]}</p>
          </div>
        </div>
        <a
          className="ctrl-btn shrink-0"
          href={cfg.chatUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="在新窗口打开腾讯 ADP 真机"
        >
          Open ADP
          <ExternalLink size={15} />
        </a>
      </header>

      <div className="relative min-h-0 flex-1">
        {!forceExternal && (
          <iframe
            src={cfg.chatUrl}
            title="腾讯云智能 ADP 真机"
            className={cn(
              "absolute inset-0 h-full w-full border-0 bg-white",
              state === "blocked" && "invisible",
            )}
            onLoad={() => {
              loadedRef.current = true;
              setState((s) => (s === "blocked" ? "blocked" : "embedded"));
            }}
          />
        )}

        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="size-8 animate-spin rounded-full border-2 border-line-strong border-t-brand" />
          </div>
        )}

        {state === "blocked" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full border border-line bg-raised">
              <ShieldAlert size={26} className="text-riskc" />
            </span>
            <div>
              <p className="t-card-title">腾讯 ADP 真机演示</p>
              <p className="t-caption mx-auto mt-2 max-w-[36em] leading-relaxed">
                浏览器安全策略（X-Frame-Options / CSP frame-ancestors）阻止了内嵌展示。
                录制阶段请点击「Open ADP」在真实窗口运行，并用 OBS「窗口捕获」采集画面；
                Showcase 不会为嵌入成功而降低安全边界。
              </p>
            </div>
            {mixedContent && (
              <p className="t-caption text-riskc">提示：HTTPS 页面内嵌 HTTP 地址会被浏览器拦截（混合内容）。</p>
            )}
          </div>
        )}

        {state === "external-only" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-10 text-center">
            <p className="t-card-title">腾讯 ADP 真机演示</p>
            <p className="t-caption max-w-[32em] leading-relaxed">
              本模式不渲染 iframe。请使用外开窗口运行 ADP，录制时由 OBS 捕获。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
