/** 校区 → 视觉色映射（Phase 2.8 同源品牌：珊瑚 / 玫瑰 / 淡紫 / 粉橘）。 */

export interface CampusStyle { color: string; dim: string; bright: string }

const MAP: Record<string, CampusStyle> = {
  校区A: { color: "var(--brand)", dim: "var(--brand-dim)", bright: "rgba(232,91,69,0.28)" },
  校区B: { color: "#bd6d78", dim: "rgba(189,109,120,0.14)", bright: "rgba(189,109,120,0.3)" },
  校区C: { color: "#9e89b9", dim: "rgba(158,137,185,0.14)", bright: "rgba(158,137,185,0.3)" },
  校区D: { color: "#c08a72", dim: "rgba(192,138,114,0.13)", bright: "rgba(192,138,114,0.28)" },
};

const FALLBACK: CampusStyle = { color: "var(--text-muted)", dim: "rgba(154,130,123,0.12)", bright: "rgba(154,130,123,0.26)" };

export function campusStyle(name: string): CampusStyle {
  return MAP[name] ?? FALLBACK;
}

export const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五"] as const;
