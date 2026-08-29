import collabFixture from "../../fixtures/heroes/collaboration.json";
import { assertFixtureProvenance } from "../provenance/validate";
import type { CollaborationViewModel } from "./types";

/** 三人共同空闲 → 空间收敛漏斗 ViewModel */
export function buildCollaborationViewModel(): CollaborationViewModel {
  const f = collabFixture;
  assertFixtureProvenance(f as never, { sceneId: "hero-collaboration", requireVerified: true });
  const p = f.payload;
  return {
    participants: p.participants.map((t) => t.name),
    slot: {
      weekday: p.slot.weekday,
      weekdayName: p.slot.weekdayName,
      date: p.slot.date,
      periodText: "第" + p.slot.periodStart + "-" + p.slot.periodEnd + "节",
      timeText: p.slot.timeText,
    },
    lanes: p.morningBusy.map((m) => ({
      teacher: m.teacher,
      busy: m.blocks.map((b) => ({ ...b })),
    })),
    funnel: { ...p.funnel },
    candidatesCap120: p.candidatesCap120.map((r) => ({ ...r })),
    recommended: { ...p.recommendedRoom },
  };
}