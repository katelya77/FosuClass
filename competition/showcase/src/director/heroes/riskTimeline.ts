import type { BeatDef } from "./types";

/** HeroRisk —— 时间与空间之间的隐形风险 */
export const RISK_BEATS: BeatDef[] = [
  { id: "risk.identity", at: 0.8 },
  { id: "risk.schedule", at: 3.2 },
  { id: "risk.campuses", at: 7.6 },
  { id: "risk.routes", at: 11.0 },
  { id: "risk.gap", at: 15.0 },
  { id: "risk.warning", at: 18.2 },
  { id: "risk.summary", at: 21.2 },
];
export const RISK_DURATION = 24;