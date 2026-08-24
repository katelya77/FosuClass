import type { BeatDef } from "./types";

/** HeroInsight —— Rank Cascade → Top1 抽取 → 下钻证据链 */
export const INSIGHT_BEATS: BeatDef[] = [
  { id: "insight.cascade", at: 0.8 },
  { id: "insight.top1", at: 6.2 },
  { id: "insight.breadcrumb", at: 9.8 },
  { id: "insight.schedule", at: 12.6 },
  { id: "insight.risk", at: 18.0 },
  { id: "insight.close", at: 22.4 },
];
export const INSIGHT_DURATION = 28;
