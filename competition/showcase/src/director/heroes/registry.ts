import type { SceneId } from "../types";
import type { BeatDef } from "./types";
import { RISK_BEATS, RISK_DURATION } from "./riskTimeline";
import { COLLAB_BEATS, COLLAB_DURATION } from "./collaborationTimeline";
import { RESCHEDULE_BEATS, RESCHEDULE_DURATION } from "./rescheduleTimeline";
import { INSIGHT_BEATS, INSIGHT_DURATION } from "./insightTimeline";

export interface HeroTimeline { beats: BeatDef[]; duration: number }

export const HERO_TIMELINES: Partial<Record<SceneId, HeroTimeline>> = {
  "hero-risk": { beats: RISK_BEATS, duration: RISK_DURATION },
  "hero-collaboration": { beats: COLLAB_BEATS, duration: COLLAB_DURATION },
  "hero-reschedule": { beats: RESCHEDULE_BEATS, duration: RESCHEDULE_DURATION },
  "hero-insight": { beats: INSIGHT_BEATS, duration: INSIGHT_DURATION },
};

/** ?beat= 参数 → 场景与场景内偏移 */
export function resolveBeat(beatId: string): { scene: SceneId; at: number } | null {
  for (const [scene, t] of Object.entries(HERO_TIMELINES)) {
    const hit = (t as HeroTimeline).beats.find((b) => b.id === beatId);
    if (hit) return { scene: scene as SceneId, at: hit.at };
  }
  return null;
}