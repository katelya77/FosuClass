import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

import { AGENT_BRANDS, CHAT_BACKGROUND } from "../data/branding";
import { isMixedContentEmbed, resolveAdpConfig, type AdpFrameConfig } from "../lib/adp";
import { cn } from "../lib/cn";
import { MagneticButton } from "./MagneticButton";

export type AdpState = "loading" | "embedded" | "blocked" | "external";

interface AdpExperienceProps {
  config?: AdpFrameConfig;
  className?: string;
  forceExternal?: boolean;
  timeoutMs?: number;
  showHeader?: boolean;
}

const STATUS_TEXT: Record<AdpState, string> = {
  loading: "正在连接小序真机…",
  embedded: "实时运行 · 可交互",
  blocked: "内嵌被浏览器策略阻止",
  external: "外部窗口模式",
};

const DOT_COLOR: Record<AdpState, string> = {
  loading: "var(--brand-soft)",
  embedded: "#35b06a",
  blocked: "#d95b47",
  external: "var(--mute)",
};

/**
 * AdpExperience —— 全应用唯一一层 iframe Adapter。
 * 不读取、不修改 iframe DOM，不绕过 X-Frame-Options / CSP 或 mixed-content 限制；
 * 被阻止时降级为「打开小序完整体验」外开卡片，绝不白屏报错。
 */
export function AdpExperience({
  config,
  className,
  forceExternal = false,
  timeoutMs = 5000,
  showHeader = true,
}: AdpExperienceProps): React.ReactElement {
  const cfg = config ?? resolveAdpConfig();
  const coordinator = AGENT_BRANDS[0];
  const loadedRef = useRef(false);

  const mixedContent =
    typeof window !== "undefined" && isMixedContentEmbed(window.location.protocol, cfg.chatUrl);

  const [state, setState] = useState<AdpState>(() => {
    if (forceExternal) return "external";
    if (mixedContent) return "blocked";
    return "loading";
  });

  useEffect(() => {
    if (forceExternal || mixedContent) return;
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) setState("blocked");
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [forceExternal, mixedContent, timeoutMs]);

  const onLoad = () => {
    loadedRef.current = true;
    if (!mixedContent && state !== "blocked") setState("embedded");
  };

  const renderIframe = !forceExternal && !mixedContent;

  return (
    <section
      data-state={state}
      className={cn("liquid-glass flex min-h-0 flex-col overflow-hidden rounded-[26px]", className)}
    >
      {showHeader && (
        <header className="flex items-center justify-between gap-3 border-b border-white/30 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                state === "loading" && "animate-pulse",
              )}
              style={{ background: DOT_COLOR[state] }}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">小序真机 · 实时对话</p>
              <p className="truncate text-[11px] text-mute">{STATUS_TEXT[state]}</p>
            </div>
          </div>
          <a
            className="glass-button shrink-0 px-3 py-1.5 text-xs"
            href={cfg.chatUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="在新窗口打开小序真机"
          >
            <ExternalLink size={14} />
            打开小序
          </a>
        </header>
      )}

      <div className="relative min-h-[420px] flex-1">
        <img
          src={CHAT_BACKGROUND.image}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-[0.16]"
          style={{ objectPosition: "center 66%" }}
        />
        <span className="absolute inset-0 bg-gradient-to-b from-white/48 via-white/22 to-[#fff7f3]/62" aria-hidden />
        {renderIframe && (
          <iframe
            src={cfg.chatUrl}
            title="校园智序 · 小序 真机体验"
            className={cn(
              "absolute inset-0 h-full w-full border-0",
              state === "blocked" && "invisible",
            )}
            onLoad={onLoad}
            referrerPolicy="no-referrer"
            allow="clipboard-write"
          />
        )}

        {state === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-10 text-center">
            <div className="adp-brand-orb animate-float">
              <img src={coordinator.image} alt="" aria-hidden className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-semibold text-ink">小序正在准备真实对话</span>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/40">
              <div className="h-full w-1/2 animate-[loadingbar_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-brand-soft to-brand" />
            </div>
            <p className="max-w-[28em] text-xs text-mute">连接真实 ADP 真机。页面不会读取或修改真机内部内容。</p>
          </div>
        )}

        {state === "blocked" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 py-12 text-center">
            <div className="adp-brand-orb">
              <img src={coordinator.image} alt="" aria-hidden className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-xl font-semibold text-ink">打开小序完整体验</p>
              <p className="mx-auto mt-2 max-w-[34em] text-sm leading-relaxed text-body">
                当前页面会继续保留案例与引导。点击按钮，在新窗口进入真实小序，直接开始对话。
              </p>
            </div>
            {mixedContent && (
              <p className="rounded-full border border-brand/20 bg-brand-tint px-4 py-1.5 text-xs font-medium text-brand-deep">
                已自动切换：HTTPS 页面不能内嵌当前 HTTP 真机
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              <MagneticButton href={cfg.chatUrl} target="_blank" variant="brand" className="px-6 py-3 text-sm">
                打开小序完整体验 <ExternalLink size={16} />
              </MagneticButton>
              <MagneticButton href={cfg.webimUrl} target="_blank" variant="glass" className="px-5 py-3 text-sm">
                打开 WebIM 备用入口 <ExternalLink size={15} />
              </MagneticButton>
            </div>
          </div>
        )}

        {state === "external" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-10 text-center">
            <div className="adp-brand-orb">
              <img src={coordinator.image} alt="" aria-hidden className="h-full w-full object-contain" />
            </div>
            <p className="text-lg font-semibold text-ink">外部窗口模式</p>
            <p className="max-w-[32em] text-sm text-body">
              本模式不渲染 iframe，适合录制时由 OBS 捕获真实 ADP 窗口。请点击按钮外开真机。
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <MagneticButton href={cfg.chatUrl} target="_blank" variant="brand" className="px-6 py-3 text-sm">
                打开小序完整体验 <ExternalLink size={16} />
              </MagneticButton>
              <MagneticButton href={cfg.webimUrl} target="_blank" variant="glass" className="px-5 py-3 text-sm">
                WebIM 备用入口 <ExternalLink size={15} />
              </MagneticButton>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
