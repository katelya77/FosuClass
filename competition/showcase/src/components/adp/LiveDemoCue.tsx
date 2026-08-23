import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { LIVE_DEMO_PROMPTS, type LiveDemoPrompt } from "../../live-demo/prompts";
import { cn } from "../../lib/cn";

/**
 * LiveDemoCue —— 录制现场的操作员提示（仅开发模式）。
 * 键盘 1~6 复制对应 Demo Prompt；绝不注入 iframe，只复制公开任务文本。
 */
export function LiveDemoCue({ activeKey }: { activeKey?: string }): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (p: LiveDemoPrompt) => {
    try {
      await navigator.clipboard.writeText(p.prompt);
      setCopied(p.key);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      // 剪贴板被拒时静默；不 fallback 到注入 iframe
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {LIVE_DEMO_PROMPTS.map((p, i) => {
        const active = p.key === activeKey;
        return (
          <button
            key={p.key}
            onClick={() => copy(p)}
            className={cn(
              "group flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-left transition-all duration-300",
              active ? "border-[color-mix(in_srgb,var(--brand)_50%,transparent)] bg-[var(--brand-dim)]"
                     : "border-line bg-canvas-deep/60 hover:border-[var(--border-strong)]",
            )}
            aria-label={"复制 Demo Prompt：" + p.label}
          >
            <div className="min-w-0">
              <p className={cn("text-[13.5px] font-medium", active ? "text-brand-strong" : "text-ink")}>
                <span className="t-mono mr-2 text-[11px] text-faint">{i + 1}</span>{p.label}
              </p>
              <p className="t-caption truncate">{p.proves}</p>
            </div>
            <span className="shrink-0 text-mute group-hover:text-brand-strong">
              {copied === p.key ? <Check size={16} className="text-ok" /> : <Copy size={15} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
