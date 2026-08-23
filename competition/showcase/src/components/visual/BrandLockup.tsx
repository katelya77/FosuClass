import { motion } from "motion/react";
import { cn } from "../../lib/cn";

interface BrandLockupProps {
  /** 入场基础延迟（秒）——由场景节拍决定 */
  delay?: number;
  align?: "left" | "center";
  className?: string;
}

function riseV(base: number, i: number) {
  return {
    hidden: { opacity: 0, y: 18 },
    show: {
      opacity: 1,
      y: 0,
      transition: { delay: base + i * 0.18, duration: 0.85, ease: [0.22, 1, 0.36, 1] as const },
    },
  };
}

/** 品牌锁定：kicker + 中文主标 + 一句核心叙事。Opening 与 Closing 共用。 */
export function BrandLockup({ delay = 0, align = "left", className }: BrandLockupProps): JSX.Element {
  return (
    <div className={cn("flex flex-col gap-6", align === "center" ? "items-center" : "items-start", className)}>
      <motion.div
        variants={riseV(delay, 0)}
        initial="hidden"
        animate="show"
        className="flex items-center gap-3"
      >
        <span className="inline-block h-px w-10 bg-[var(--brand)] opacity-70" />
        <span className="t-kicker text-faint">Temporal Campus OS</span>
      </motion.div>

      <motion.h1
        variants={riseV(delay, 1)}
        initial="hidden"
        animate="show"
        className={cn("t-hero whitespace-nowrap", align === "center" && "text-center")}
      >
        校园智序<span className="mx-3 font-light text-brand">·</span>小序
      </motion.h1>

      <motion.p
        variants={riseV(delay, 2)}
        initial="hidden"
        animate="show"
        className={cn(
          "t-body max-w-[30em] text-mute",
          align === "center" && "mx-auto text-center",
        )}
      >
        从查询校园信息，到理解<span className="font-medium text-ink">教学运行</span>
        并<span className="font-medium text-ink">辅助决策</span>。
      </motion.p>
    </div>
  );
}