import type { PointerEvent, ReactNode, ReactElement } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";

import { cn } from "../lib/cn";

interface MagneticButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
  ariaLabel?: string;
  strength?: number;
  variant?: "glass" | "brand";
  type?: "button" | "submit";
}

/** Slight magnetic pull toward the cursor using Motion springs, rather than a plain scale. */
export function MagneticButton({
  children,
  className,
  onClick,
  href,
  target,
  rel,
  ariaLabel,
  strength = 0.22,
  variant = "glass",
  type = "button",
}: MagneticButtonProps): ReactElement {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 240, damping: 18, mass: 0.6 });
  const springY = useSpring(y, { stiffness: 240, damping: 18, mass: 0.6 });

  const onMove = (event: PointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const offsetX = (event.clientX - (rect.left + rect.width / 2)) * strength;
    const offsetY = (event.clientY - (rect.top + rect.height / 2)) * strength * 0.72;
    x.set(offsetX);
    y.set(offsetY);
  };

  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  const common = {
    onPointerMove: onMove,
    onPointerLeave: onLeave,
    className: cn(variant === "brand" ? "brand-button" : "glass-button", className),
    style: { x: springX, y: springY },
    "aria-label": ariaLabel,
    whileTap: { scale: 0.97 },
  };

  if (href) {
    return (
      <motion.a
        {...common}
        href={href}
        target={target}
        rel={rel ?? "noreferrer noopener"}
        onClick={onClick}
      >
        {children}
      </motion.a>
    );
  }

  return (
    <motion.button {...common} type={type} onClick={onClick}>
      {children}
    </motion.button>
  );
}
