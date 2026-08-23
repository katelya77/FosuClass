import { motion } from "motion/react";
import type { ReactNode } from "react";
import { DUR, EASE_OUT, EASE_IO } from "../../motion/motionTokens";

export type TransitionKind = "focus" | "sweep" | "collapse";

/**
 * SceneTransition —— Phase 2.5 重做：不再是单一 fade，而是三套镜头转场。
 *   A. Temporal Focus：节点/数据点"被拉入焦点"（scale 1.06→1 + 失焦清醒）。
 *   B. Data Sweep：关系线/扫描线从左至右扫过，下一 Scene 从其后显影。
 *   C. Spatial Collapse：当前关系收束为一点再展开下一场景（scale 0.94→1 + 高光冷闪）。
 */
function variantsFor(kind: TransitionKind) {
  switch (kind) {
    case "sweep":
      return {
        enter: { opacity: 0, x: -42, scale: 0.995, filter: "blur(9px)" },
        center: { opacity: 1, x: 0, scale: 1, filter: "blur(0px)" },
        exit: { opacity: 0, x: 30, scale: 1.002, filter: "blur(7px)" },
      } as const;
    case "collapse":
      return {
        enter: { opacity: 0, scale: 0.93, filter: "blur(10px) brightness(1.18)" },
        center: { opacity: 1, scale: 1, filter: "blur(0px) brightness(1)" },
        exit: { opacity: 0, scale: 0.97, filter: "blur(6px) brightness(1.08)" },
      } as const;
    default: // focus
      return {
        enter: { opacity: 0, scale: 1.05, filter: "blur(11px)", y: 12 },
        center: { opacity: 1, scale: 1, filter: "blur(0px)", y: 0 },
        exit: { opacity: 0, scale: 1.01, filter: "blur(8px)", y: -8 },
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
        duration: DUR.scene / 1000,
        ease: EASE_OUT,
        opacity: { duration: 0.66, ease: "easeOut" },
      }}
    >
      {children}
      {isSweep && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-[36vw]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(124,228,189,0.10) 45%, rgba(124,228,189,0.04) 100%)",
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