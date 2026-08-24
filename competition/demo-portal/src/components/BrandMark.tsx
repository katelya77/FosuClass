import { motion } from "motion/react";
import type { ReactElement } from "react";

import { cn } from "../lib/cn";

interface BrandMarkProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const SIZE = {
  sm: { tile: "size-10", word: "text-base" },
  md: { tile: "size-12", word: "text-lg" },
  lg: { tile: "size-16", word: "text-2xl" },
} as const;

/** 校园智序·小序 品牌锁定：始终使用平台官方图标，不再以文字代替 Logo。 */
export function BrandMark({ className, size = "md", showText = true }: BrandMarkProps): ReactElement {
  const s = SIZE[size];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <motion.div
        layout
        className={cn("relative shrink-0 overflow-hidden rounded-[30%]", s.tile)}
        style={{
          boxShadow:
            "0 12px 30px rgba(184, 57, 39, 0.26), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        <img
          src="/branding/platform-logo.png"
          alt="校园智序 · 小序平台图标"
          className="h-full w-full object-contain"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background:
              "radial-gradient(circle at 24% 10%, rgba(255,255,255,0.3), transparent 38%), linear-gradient(90deg, rgba(255,255,255,0.12), transparent 58%)",
          }}
        />
      </motion.div>
      {showText && (
        <div className="leading-tight">
          <p className={cn("whitespace-nowrap font-semibold tracking-tight text-ink", s.word)}>
            校园智序<span className="mx-1 text-brand">·</span>小序
          </p>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-mute">
            Campus Intelligence
          </p>
        </div>
      )}
    </div>
  );
}
