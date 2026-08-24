import { motion } from "motion/react";
import type { ReactElement } from "react";

import { cn } from "../lib/cn";

interface BrandMarkProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const SIZE = {
  sm: { tile: "size-9", text: "text-lg", word: "text-base" },
  md: { tile: "size-12", text: "text-2xl", word: "text-lg" },
  lg: { tile: "size-16", text: "text-3xl", word: "text-2xl" },
} as const;

/** 校园智序·小序 品牌锁定：温暖的珊瑚玻璃方块承载一个「小」字。 */
export function BrandMark({ className, size = "md", showText = true }: BrandMarkProps): ReactElement {
  const s = SIZE[size];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <motion.div
        layout
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl",
          s.tile,
        )}
        style={{
          background: "linear-gradient(138deg, #e96d51 0%, #c44534 100%)",
          boxShadow:
            "0 10px 28px rgba(184, 57, 39, 0.32), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        <span className={cn("font-bold text-[#fff7f3] drop-shadow-sm", s.text)}>小</span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 24% 12%, rgba(255,255,255,0.5), transparent 42%), linear-gradient(90deg, rgba(255,255,255,0.22), transparent 60%)",
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
