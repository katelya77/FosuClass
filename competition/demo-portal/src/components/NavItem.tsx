import type { ReactElement } from "react";
import { motion } from "motion/react";

import { cn } from "../lib/cn";
import { type NavItem as NavItemData } from "../data/navigation";

interface NavItemProps {
  item: NavItemData;
  index: number;
  active: boolean;
  onClick: () => void;
}

export function NavItem({ item, index, active, onClick }: NavItemProps): ReactElement {
  const Icon = item.icon;
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.08 + index * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden rounded-2xl px-3.5 py-3 text-left text-sm transition-colors",
        active ? "text-brand-deep" : "text-body hover:bg-white/28 hover:text-ink",
      )}
      style={
        active
          ? {
              background:
                "linear-gradient(135deg, rgba(248, 205, 192, 0.82), rgba(255, 255, 255, 0.36))",
              boxShadow:
                "0 0 20px rgba(217, 89, 63, 0.16), inset 0 1px 0 rgba(255,255,255,0.68)",
            }
          : undefined
      }
    >
      {active && (
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <span className="shimmer-overlay shimmer-on" />
        </span>
      )}
      <Icon
        size={18}
        className={cn(
          "relative z-10 transition-colors",
          active ? "text-brand drop-shadow-[0_0_8px_rgba(217,89,63,0.5)]" : "text-mute group-hover:text-brand",
        )}
      />
      <span className="relative z-10 font-medium">{item.label}</span>
      <span
        className={cn(
          "relative z-10 ml-auto size-1.5 rounded-full transition-opacity",
          active ? "bg-brand opacity-100" : "opacity-0 group-hover:opacity-60",
        )}
      />
    </motion.button>
  );
}
