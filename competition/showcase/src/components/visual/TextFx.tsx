import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DUR, EASE_OUT, STAGGER } from "../../motion/motionTokens";

/** 逐字符显影（适用于 Hero 标题）—— 拆分中文/任何字符，mask + 上移。
 *  Phase 2.6 纪律：字符入场只用位移+透明度（过渡态），落定即 sharp，无 blur。 */
export function RevealChars({
  text,
  delay = 0,
  stagger = STAGGER.standard,
  className,
  as: As = "span",
  charClassName,
}: {
  text: string;
  delay?: number;
  stagger?: number;
  className?: string;
  as?: "span" | "h1" | "h2" | "p";
  charClassName?: string;
}): JSX.Element {
  const chars = Array.from(text);
  return (
    <As className={cn("inline-flex flex-wrap", className)} aria-label={text}>
      {chars.map((c, i) =>
        c === " " ? (
          <span key={i} className="inline-block w-[0.3em]" />
        ) : (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: "0.55em" }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay + i * stagger, duration: DUR.standard, ease: EASE_OUT }}
            className={cn("inline-block will-change-transform", charClassName)}
          >
            {c}
          </motion.span>
        ),
      )}
    </As>
  );
}

/** 整句上浮显影（适用于副标题/说明）。名字保留 BlurIn，但 Phase 2.6 起不再使用 blur——
 *  业务文字的稳定态必须完全 sharp。 */
export function BlurIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  blur?: number;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: DUR.scene, ease: EASE_OUT }}
      className={cn("will-change-transform", className)}
    >
      {children}
    </motion.div>
  );
}

/** 单行 mask 上移（用于 kicker / 标签行） */
export function RiseIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: DUR.standard, ease: EASE_OUT }}
      className={cn("will-change-transform", className)}
    >
      {children}
    </motion.div>
  );
}

/** MaskReveal —— Phase 2.6 新增：clip-path 遮罩显影（React Bits BlurText/AnimatedContent 的
 *  token 化改写）。用于 Hero 数字/关键词：动画过程可被遮罩，落定即完整 sharp。 */
export function MaskReveal({
  children,
  delay = 0,
  duration = DUR.standard,
  className,
  from = "down",
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
  from?: "down" | "up";
}): JSX.Element {
  return (
    <span className={cn("relative inline-grid overflow-hidden align-baseline", className)}>
      <motion.span
        aria-hidden
        className="col-start-1 row-start-1"
        initial={{ y: from === "down" ? "1.1em" : "-1.1em", opacity: 0 }}
        animate={{ y: "0em", opacity: 1 }}
        transition={{ delay, duration, ease: EASE_OUT }}
        style={{ willChange: "transform" }}
      >
        {children}
      </motion.span>
      <span className="col-start-1 row-start-1 invisible" aria-hidden>
        {children}
      </span>
    </span>
  );
}
