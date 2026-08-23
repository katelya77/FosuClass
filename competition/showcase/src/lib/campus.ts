/** 校区 → 视觉色映射（双色系纪律内：绿=校区A 主线，蓝阶=B/C/D）
 *  Phase 2.6：新增 bright（高亮填充）态 —— 赶场路径激活时课程块/节点同步点亮用。 */

export interface CampusStyle { color: string; dim: string; bright: string }

const MAP: Record<string, CampusStyle> = {
  校区A: { color: "var(--brand)", dim: "var(--brand-dim)", bright: "rgba(79,214,166,0.34)" },
  校区B: { color: "#7fa9d4", dim: "rgba(127,169,212,0.15)", bright: "rgba(127,169,212,0.36)" },
  校区C: { color: "#9cc2e2", dim: "rgba(156,194,226,0.14)", bright: "rgba(156,194,226,0.36)" },
  校区D: { color: "#c4d2e0", dim: "rgba(196,210,224,0.13)", bright: "rgba(196,210,224,0.34)" },
};

const FALLBACK: CampusStyle = { color: "var(--text-muted)", dim: "rgba(163,177,193,0.13)", bright: "rgba(163,177,193,0.32)" };

export function campusStyle(name: string): CampusStyle {
  return MAP[name] ?? FALLBACK;
}

export const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五"] as const;
