import type { BeatDef } from "./types";

/** HeroReschedule —— Temporal Surgery：移动 → 核验 → 收敛 → 决策 */
export const RESCHEDULE_BEATS: BeatDef[] = [
  { id: "resched.source", at: 0.8 },
  { id: "resched.lift", at: 4.2 },
  { id: "resched.snap", at: 7.6 },
  { id: "resched.constraints", at: 10.6 },
  { id: "resched.candidates", at: 16.4 },
  { id: "resched.select", at: 21.0 },
  { id: "resched.decision", at: 25.0 },
];
export const RESCHEDULE_DURATION = 28;
