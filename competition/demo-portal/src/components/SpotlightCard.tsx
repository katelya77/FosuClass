import { useRef, type PointerEvent } from "react";
import { motion, useMotionValue, useSpring, useTransform, type Variants } from "motion/react";
import type { ReactNode, ReactElement } from "react";

import { cn } from "../lib/cn";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  accent?: string;
  delay?: number;
  tilt?: boolean;
  onClick?: () => void;
}

/**
 * SpotlightCard: a glass card with a cursor-following coral light field.
 * Pointer position is written directly to CSS vars on the ref so it does not re-render.
 */
export function SpotlightCard({
  children,
  className,
  accent = "#f2b5a6",
  delay = 0,
  tilt = false,
  onClick,
}: SpotlightCardProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(50);
  const py = useMotionValue(50);
  const spring = { stiffness: 180, damping: 22, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 100], [7, -7]), spring);
  const rotateY = useSpring(useTransform(px, [0, 100], [-7, 7]), spring);
  const reveal: Variants = {
    hidden: { opacity: 0, y: 26 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] },
    },
  };

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
    px.set(x);
    py.set(y);
  };

  return (
    <motion.div
      ref={ref}
      onClick={onClick}
      onPointerLeave={() => {
        px.set(50);
        py.set(50);
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      variants={reveal}
      initial="hidden"
      animate="show"
      onPointerMove={handleMove}
      className={cn("spotlight-card liquid-glass group rounded-[26px]", className)}
      whileHover={{
        y: -6,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.34), 0 22px 60px rgba(90,44,32,0.2), 0 0 34px 2px ${accent}`,
        transition: { type: "spring", stiffness: 300, damping: 24 },
      }}
      style={tilt ? { rotateX, rotateY, transformPerspective: 900 } : undefined}
    >
      {children}
    </motion.div>
  );
}
