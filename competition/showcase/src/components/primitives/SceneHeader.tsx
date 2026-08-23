import { motion } from "motion/react";
import type { ReactNode } from "react";

interface SceneHeaderProps {
  kicker: string;
  title: string;
  badge?: ReactNode;
  /** 入场延迟（秒） */
  delay?: number;
}

/** 场景统一头部：中文 kicker + 标题 + 可选徽章 */
export function SceneHeader({ kicker, title, badge, delay = 0.15 }: SceneHeaderProps): JSX.Element {
  return (
    <motion.header
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-end justify-between gap-6"
    >
      <div>
        <p className="t-caption mb-2">{kicker}</p>
        <h2 className="t-section">{title}</h2>
      </div>
      {badge && <div className="shrink-0 pb-1">{badge}</div>}
    </motion.header>
  );
}
