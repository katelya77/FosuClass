/*
 * 基于 React Bits（https://reactbits.dev，David Haz © 2026）组件深度改造。
 * 上游：DavidHDev/react-bits @ 4e0e030193b563be6be33d928f77d0d01cefe237，src/ts-tailwind。
 * 许可：MIT + Commons Clause（见 docs/REACT-BITS-USAGE.md 的完整声明与修改清单）。
 */
import { useInView, useMotionValue, useSpring, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";

export interface CountUpProps {
  to: number;
  from?: number;
  direction?: "up" | "down";
  delay?: number;
  duration?: number;
  className?: string;
  /** 导演控制：为 false 时不启动（场景未到达该节拍） */
  startWhen?: boolean;
  separator?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

/** 数字弹簧滚动 —— 录屏语义：由 Director 节拍驱动 startWhen；
 *  prefers-reduced-motion 下直接显示终值（信息不减少）。 */
export function CountUp({
  to,
  from = 0,
  direction = "up",
  delay = 0,
  duration = 2,
  className = "",
  startWhen = true,
  separator = "",
  onStart,
  onEnd,
}: CountUpProps): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(direction === "down" ? to : from);

  const damping = 20 + 40 * (1 / duration);
  const stiffness = 100 * (1 / duration);
  const springValue = useSpring(motionValue, { damping, stiffness });

  const isInView = useInView(ref, { once: true });

  const getDecimalPlaces = (num: number): number => {
    const str = num.toString();
    if (str.includes(".")) {
      const decimals = str.split(".")[1];
      if (parseInt(decimals, 10) !== 0) return decimals.length;
    }
    return 0;
  };

  const maxDecimals = Math.max(getDecimalPlaces(from), getDecimalPlaces(to));

  const formatValue = useCallback(
    (latest: number) => {
      const options: Intl.NumberFormatOptions = {
        useGrouping: !!separator,
        minimumFractionDigits: maxDecimals,
        maximumFractionDigits: maxDecimals,
      };
      const formattedNumber = new Intl.NumberFormat("en-US", options).format(latest);
      return separator ? formattedNumber.replace(/,/g, separator) : formattedNumber;
    },
    [maxDecimals, separator],
  );

  useEffect(() => {
    if (ref.current && reduce) ref.current.textContent = formatValue(to);
  }, [reduce, to, formatValue]);

  useEffect(() => {
    if (!isInView || !startWhen || reduce) return;
    onStart?.();
    const timeoutId = setTimeout(() => {
      motionValue.set(direction === "down" ? from : to);
    }, delay * 1000);
    const durationTimeoutId = setTimeout(() => onEnd?.(), delay * 1000 + duration * 1000);
    return () => {
      clearTimeout(timeoutId);
      clearTimeout(durationTimeoutId);
    };
  }, [isInView, startWhen, reduce, motionValue, direction, from, to, delay, onStart, onEnd, duration]);

  useEffect(() => {
    if (reduce) return;
    const unsubscribe = springValue.on("change", (latest: number) => {
      if (ref.current) ref.current.textContent = formatValue(latest);
    });
    return () => unsubscribe();
  }, [springValue, formatValue, reduce]);

  return (
    <span
      ref={ref}
      className={className}
      style={{ fontVariantNumeric: "tabular-nums" }}
    />
  );
}
