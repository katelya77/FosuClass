/** 校区 → 视觉色映射（双色系纪律内：绿=校区A 主线，蓝阶=B/C/D） */

export interface CampusStyle { color: string; dim: string }

const MAP: Record<string, CampusStyle> = {
  校区A: { color: "var(--brand)", dim: "var(--brand-dim)" },
  校区B: { color: "#6f99c5", dim: "rgba(111,153,197,0.14)" },
  校区C: { color: "#8fb6d9", dim: "rgba(143,182,217,0.13)" },
  校区D: { color: "#b9c7d6", dim: "rgba(185,199,214,0.12)" },
};

const FALLBACK: CampusStyle = { color: "var(--text-muted)", dim: "rgba(148,162,178,0.12)" };

export function campusStyle(name: string): CampusStyle {
  return MAP[name] ?? FALLBACK;
}

export const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五"] as const;