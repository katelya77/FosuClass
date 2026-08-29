import type { ReactElement } from "react";
import { motion } from "motion/react";

import { cn } from "../lib/cn";
import { NAV_ITEMS } from "../data/navigation";
import { type Route } from "../lib/router";

interface MobileNavProps {
  current: Route;
  onNavigate: (route: Route) => void;
}

export function MobileNav({ current, onNavigate }: MobileNavProps): ReactElement {
  return (
    <nav className="mobile-nav liquid-glass fixed z-40 rounded-[24px] px-1 py-2 lg:hidden" aria-label="移动端主导航">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.activeRoutes.includes(current.name);
        return (
          <motion.button
            key={item.label}
            onClick={() => onNavigate(item.route)}
            whileTap={{ scale: 0.9 }}
            className={cn(
              "mobile-nav__item flex min-w-0 flex-col items-center gap-1 rounded-2xl py-1.5 text-[10px] font-medium transition-colors",
              active ? "text-brand-deep" : "text-mute",
            )}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-xl transition-colors",
                active && "bg-white/50",
              )}
              style={active ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 12px rgba(217,89,63,0.16)" } : undefined}
            >
              <Icon size={18} className={cn(active ? "text-brand" : "text-current")} />
            </span>
            <span className="mobile-nav__label">{item.label}</span>
          </motion.button>
        );
      })}
    </nav>
  );
}
