import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * 统一场景转场：enter / hold(center) / exit。
 * 电影感原则：慢入慢出、轻微位移与失焦，绝不做 display:none 式硬切。
 * 全部走 opacity/transform/filter 合成友好路径，时长 0.9s。
 */
const variants = {
  enter: { opacity: 0, scale: 0.985, y: 18, filter: "blur(10px)" },
  center: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 1.008, y: -14, filter: "blur(8px)" },
} as const;

export function SceneTransition({ children }: { children: ReactNode }): JSX.Element {
  return (
    <motion.section
      className="absolute inset-0 will-change-[opacity,transform]"
      initial="enter"
      animate="center"
      exit="exit"
      variants={variants}
      transition={{
        duration: 0.9,
        ease: [0.22, 1, 0.36, 1],
        opacity: { duration: 0.72, ease: "easeOut" },
      }}
    >
      {children}
    </motion.section>
  );
}
