/** 场景内统一的 Motion 入场参数：慢、稳、可读 */
export const EASE_OUT_SOFT = [0.22, 1, 0.36, 1] as const;

export function rise(delay: number, distance = 16) {
  return {
    initial: { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.8, ease: EASE_OUT_SOFT },
  };
}
