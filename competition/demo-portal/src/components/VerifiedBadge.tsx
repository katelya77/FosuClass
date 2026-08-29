import { BadgeCheck } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "../lib/cn";
import { VERIFIED_COPY } from "../data/navigation";

interface VerifiedBadgeProps {
  className?: string;
  showPackage?: boolean;
  compact?: boolean;
}

export function VerifiedBadge({
  className,
  showPackage = true,
  compact = false,
}: VerifiedBadgeProps): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/42 text-[11px] font-medium backdrop-blur-md",
        compact ? "px-2.5 py-1" : "px-3 py-1.5",
        className,
      )}
      style={{
        color: "var(--ink)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.7), 0 5px 16px rgba(90,44,32,0.1)",
      }}
    >
      <BadgeCheck size={compact ? 13 : 14} className="shrink-0 text-brand" />
      <span>{VERIFIED_COPY.mark}</span>
      {showPackage && (
        <span className="text-mute" aria-hidden>
          ·
        </span>
      )}
      {showPackage && <span className="font-semibold text-brand-strong">{VERIFIED_COPY.package}</span>}
    </span>
  );
}
