import type { ReactElement } from "react";

import { AGENT_BRANDS } from "../data/branding";
import { cn } from "../lib/cn";

interface AgentBrandStripProps {
  className?: string;
  compact?: boolean;
}

/**
 * AgentBrandStrip：四位校园 Agent + CampusTools 插件的品牌条。
 * 方形 App 图标统一 object-contain，不拉伸、不裁切。
 */
export function AgentBrandStrip({ className, compact = false }: AgentBrandStripProps): ReactElement {
  return (
    <ul
      className={cn(
        "agent-brand-strip grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5",
        compact && "gap-2.5 sm:gap-3",
        className,
      )}
      aria-label="协作智能体与 CampusTools 插件"
    >
      {AGENT_BRANDS.map((brand) => (
        <li key={brand.id} className="agent-brand-node" data-role={brand.id}>
          <div
            className="agent-brand-jelly liquid-glass flex h-full flex-col rounded-[22px] p-3 sm:p-4"
            style={{
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.72), 0 14px 32px rgba(90,44,32,0.1)",
            }}
          >
            <span
              className="relative flex w-full items-center justify-center overflow-hidden rounded-[16px] border border-white/45 bg-white/30"
              style={{
                aspectRatio: "1 / 1",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
              }}
            >
              <img
                src={brand.image}
                alt={brand.name}
                loading="lazy"
                className="h-full w-full object-contain"
                style={{ filter: `drop-shadow(0 10px 20px ${brand.accent}33)` }}
              />
            </span>
            <div className="mt-3 min-w-0 text-center">
              <p className="truncate text-sm font-bold text-ink">{brand.name}</p>
              <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-mute">
                {brand.en}
              </p>
              <p className="mt-1.5 line-clamp-1 text-[11px] text-body">{brand.role}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
