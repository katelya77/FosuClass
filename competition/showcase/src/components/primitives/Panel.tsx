import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface PanelProps {
  kicker?: string;
  title?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  raised?: boolean;
}

/** 统一面板原语 —— 所有 Hero 场景的卡片基底，避免散落样式 */
export function Panel({ kicker, title, badge, children, className, raised = false }: PanelProps): JSX.Element {
  return (
    <section className={cn(raised ? "panel-raised" : "panel", "flex flex-col", className)}>
      {(kicker || title || badge) && (
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0">
            {kicker && <p className="t-caption mb-1">{kicker}</p>}
            {title && <h3 className="t-card-title truncate">{title}</h3>}
          </div>
          {badge && <div className="shrink-0 pt-1">{badge}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1 px-6 pb-6">{children}</div>
    </section>
  );
}
