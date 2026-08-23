import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DUR, EASE_OUT, STAGGER } from "../../motion/motionTokens";

/** 逐字符显影（适用于 Hero 标题）—— 拆分中文/任何字符，mask + 上移 + 失焦 */
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

/** 整句失焦显影（适用于副标题/说明） */
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