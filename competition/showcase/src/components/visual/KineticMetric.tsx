import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "../../lib/cn";

export interface KineticMetricProps {
  /** 最终展示的真实业务值 */
  to: number;
  /** settle=false 时为"尚未结算"的扫描态（明显在算）；true 时 250~400ms 内结算到终值 */
  settle?: boolean;
  delay?: number;
  className?: string;
  unit?: string;
  decimals?: number;
}

/**
 * KineticMetric —— Phase 2.6：确定性指标动画（digit-mask settle）。
 * 关键纪律：中间帧绝不呈现为"看起来可信的业务数字"。
 *   · settle=false → 遮罩扫描态（乱纹 + blur + 扫光）
 *   · settle=true  → 300ms 内乱纹逐位锁定到真实终值，然后才出现单位/标签
 * 计数经过的任何数值都只是乱纹位，不会拼出 61/6/53/100 这类中间业务值。
 */
export function KineticMetric({
  to,
  settle = false,
  delay = 0,
  className,
  unit,
  decimals = 0,
}: KineticMetricProps): JSX.Element {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState<string>("· · ·");
  const [settled, setSettled] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const fmt = (v: number): string => v.toFixed(decimals);
  const width = Math.max(fmt(to).length, 1);
  const scanning = !settled && settle === false;

  // 乱纹字符集：视觉上"明显不是数据"，且宽度与终值一致（tabular-nums 不跳动）
  const GLYPHS = "0123456789";
  const scrambleFor = (progress: number): string => {
    // progress 0→1：从左到右逐位锁定；未锁定位显示乱纹
    const locked = Math.floor(progress * (width + 0.35));
    let out = "";
    for (let i = 0; i < width; i++) {
      const ch = fmt(to)[i];
      if (i < locked || ch === "." || ch === ",") out += ch;
      else out += GLYPHS[Math.abs(((i + 1) * 7 + Math.floor(progress * 97)) % 10)];
    }
    return out;
  };

  useEffect(() => {
    if (settle) {
      if (reduce) {
        setDisplay(fmt(to));
        setSettled(true);
        return;
      }
      startRef.current = null;
      setSettled(false);
      const start = delay * 1000;
      const run = (t: number) => {
        if (startRef.current === null) startRef.current = t;
        const elapsed = t - startRef.current;
        if (elapsed < start) {
          setDisplay(scrambleFor(0));
          rafRef.current = requestAnimationFrame(run);
          return;
        }
        const p = Math.min((elapsed - start) / 300, 1); // 250~400ms 纪律
        setDisplay(scrambleFor(1 - Math.pow(1 - p, 3)));
        if (p >= 1) {
          setDisplay(fmt(to));
          setSettled(true);
          rafRef.current = null;
        } else {
          rafRef.current = requestAnimationFrame(run);
        }
      };
      rafRef.current = requestAnimationFrame(run);
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      };
    }
    setSettled(false);
    setDisplay("· · ·");
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settle, reduce, to, delay, decimals]);

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
