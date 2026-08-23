import { motion } from "motion/react";
import type { ReactNode } from "react";
import { DUR, EASE_OUT, EASE_IO } from "../../motion/motionTokens";

export type TransitionKind = "focus" | "sweep" | "collapse";

/**
 * SceneTransition —— Phase 2.6：三套镜头转场，blur 只属于过渡本身。
 *   A. Temporal Focus：推近→落定（轻微失焦清醒，≤6px，0.7s 内归零）。
 *   B. Data Sweep：光带从左至右扫过，下一 Scene 从其后显影。
 *   C. Spatial Collapse：收束为一点再展开（高光冷闪）。
 * 稳定态 filter 恒为 blur(0px)——业务画面绝不带虚焦。
 */
function variantsFor(kind: TransitionKind) {
  switch (kind) {
    case "sweep":
      return {
        enter: { opacity: 0, x: -34, scale: 0.997, filter: "blur(5px)" },
        center: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)" },
        exit: { opacity: 0, x: 26, scale: 1.001, filter: "blur(4px)" },
      } as const;
    case "collapse":
      return {
        enter: { opacity: 0, scale: 0.955, filter: "blur(6px) brightness(1.14)" },
        center: { opacity: 1, scale: 1, filter: "blur(0px) brightness(1)" },
        exit: { opacity: 0, scale: 0.985, filter: "blur(4px) brightness(1.05)" },
      } as const;
    default: // focus
      return {
        enter: { opacity: 0, scale: 1.035, filter: "blur(6px)", y: 10 },
        center: { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 },
        exit: { opacity: 0, scale: 1.008, filter: "blur(4px)", y: -6 },
      } as const;
  }
}

export function SceneTransition({ kind, children }: { kind: TransitionKind; children: ReactNode }): JSX.Element {
  const variants = variantsFor(kind);
  const isSweep = kind === "sweep";
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden will-change-[opacity,transform,filter]"
      initial="enter"
      animate="center"
      exit="exit"
      variants={variants}
      transition={{
        duration: DUR.scene,
        ease: EASE_OUT,
        opacity: { duration: 0.5, ease: "easeOut" },
        filter: { duration: 0.62, ease: EASE_IO },
      }}
    >
      {children}
      {isSweep && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-[36vw]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(124,228,189,0.12) 45%, rgba(124,228,189,0.05) 100%)",
          }}
          initial={{ left: "-38vw" }}
          animate={{ left: "118vw" }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.85, ease: EASE_IO }}
        />
      )}
    </motion.section>
  );
}
