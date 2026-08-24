import type { ReactElement } from "react";

import { NavItem } from "./NavItem";
import { BrandMark } from "./BrandMark";
import { VerifiedBadge } from "./VerifiedBadge";
import { NAV_ITEMS, VERIFIED_COPY } from "../data/navigation";
import { type Route } from "../lib/router";

interface SidebarProps {
  current: Route;
  onNavigate: (route: Route) => void;
}

export function Sidebar({ current, onNavigate }: SidebarProps): ReactElement {
  return (
    <aside className="liquid-glass flex h-full flex-col rounded-[30px] p-4">
      <div className="px-2 py-3">
        <BrandMark size="md" />
      </div>

      <nav className="mt-3 flex flex-1 flex-col gap-1.5">
        {NAV_ITEMS.map((item, index) => (
          <NavItem
            key={item.label}
            item={item}
            index={index}
            active={item.activeRoutes.includes(current.name)}
            onClick={() => onNavigate(item.route)}
          />
        ))}
      </nav>

      <div className="mt-4 border-t border-white/25 pt-4">
        <div className="flex items-center gap-2 px-2 text-[11px] text-mute">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span>实时可用</span>
        </div>
        <VerifiedBadge compact showPackage className="mt-3 w-full justify-center" />
        <p className="mt-2 px-2 text-center text-[10px] text-mute">
          {VERIFIED_COPY.package} · {VERIFIED_COPY.badge}
        </p>
      </div>
    </aside>
  );
}
