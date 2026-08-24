import { motion, type Variants } from "motion/react";
import type { ReactNode, ReactElement } from "react";

import { cn } from "../lib/cn";

interface GlassSurfaceProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  rounded?: "xl" | "2xl";
  delay?: number;
}

const reveal: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.75, ease: [0.22, 1, 0.36, 1] },
  },
};

/** Auroraqua Iced Jelly surface: translucent, blurred, with an inner top highlight. */
export function GlassSurface({
  children,
  className,
  glow = false,
  rounded = "2xl",
  delay = 0,
}: GlassSurfaceProps): ReactElement {
  return (
    <motion.div
      variants={reveal}
      initial="hidden"
      animate="show"
      transition={{ delay }}
      className={cn(
        "liquid-glass",
        glow && "liquid-glass-glow",
        rounded === "xl" ? "rounded-[20px]" : "rounded-[28px]",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
