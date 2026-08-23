import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "../../lib/cn";

export interface KineticMetricProps {
  /** 最终展示的真实业务值 */
  to: number;
  from?: number;
  /** settle=false 时为"尚未结算"的扫描态（明显在算）；true 时快速 settle 到终值 */
  settle?: boolean;
  direction?: "up" | "down";
  delay?: number;
  className?: string;
  unit?: string;
  decimals?: number;
}

/**
 * KineticMetric —— 替代普通 CountUp 的"确定性指标动画"。
 * 关键点：中间帧绝不呈现为"稳定业务数据"。
 *   · settle=false → 模糊/掩码扫描态
 *   · settle=true  → 250~450ms 快速 settle 到真实终值，然后才出现单位/标签
 */
export function KineticMetric({
  to,
  from = 0,
  settle = false,
  direction = "up",
  delay = 0,
  className,
  unit,
  decimals = 0,
}: KineticMetricProps): JSX.Element {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState<string>("—");
  const [settled, setSettled] = useState(false);
  const startRef = useRef<number | null>(null);

  const fmt = (v: number): string => v.toFixed(decimals);

  const scanning = !settled && settle === false;

  useEffect(() => {
    if (settle && reduce) {
      setDisplay(fmt(to));
      setSettled(true);
    }
  }, [settle, reduce, to, decimals]);

  useEffect(() => {
    if (!settle || reduce) return;
    startRef.current = null;
    setSettled(false);
    const start = delay * 1000;
    const run = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      if (elapsed < start) {
        setDisplay("· · ·");
        requestAnimationFrame(run);
        return;
      }
      const p = Math.min((elapsed - start) / 380, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = direction === "down" ? from - (from - to) * eased : from + (to - from) * eased;
      setDisplay(fmt(value));
      if (p >= 1) {
        setDisplay(fmt(to));
        setSettled(true);
      } else {
        requestAnimationFrame(run);
      }
    };
    requestAnimationFrame(run);
  }, [settle, reduce, to, from, direction, delay, decimals]);

  return (
    <span className={cn("inline-flex items-baseline", className)}>
      <span
        className={cn("kinetic-num", scanning && "kinetic-scan")}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {display}
      </span>
      {unit && settled && (
        <span className="ml-1.5 t-label align-baseline transition-opacity duration-300">{unit}</span>
      )}
    </span>
  );
}
