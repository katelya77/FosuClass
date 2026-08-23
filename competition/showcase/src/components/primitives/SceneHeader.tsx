import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface SceneHeaderProps {
  kicker: string;
  title?: string;
  /** Phase 2：headline 别名 */
  headline?: string;
  sub?: string;
  badge?: ReactNode;
  delay?: number;
}

/** 场景统一头部：kicker + 中文主标 + 可选补充行 + 徽章 */
export function SceneHeader(props: SceneHeaderProps): JSX.Element {
  const main = props.headline ?? props.title;
  return (
    <motion.header
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: props.delay ?? 0.15, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className='flex items-end justify-between gap-6'
    >
      <div className='min-w-0'>
        <p className='t-caption mb-2'>{props.kicker}</p>
        {main ? <h2 className='t-section'>{main}</h2> : null}
        {props.sub ? <p className='t-caption mt-1.5'>{props.sub}</p> : null}
      </div>
      {props.badge ? <div className='shrink-0 pb-1'>{props.badge}</div> : null}
    </motion.header>
  );
}