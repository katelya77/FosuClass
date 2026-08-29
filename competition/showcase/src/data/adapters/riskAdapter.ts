import riskFixture from "../../fixtures/heroes/risk.json";
import { assertFixtureProvenance, isVerifiedFixture } from "../provenance/validate";
import type { RiskViewModel } from "./types";

type RiskFixtureShape = typeof riskFixture;

/** 教师025 风险发现 —— 原始工具结果 → 稳定 ViewModel（事实零改写） */
export function buildRiskViewModel(): RiskViewModel {
  const f = riskFixture as unknown as RiskFixtureShape & { payload: RiskFixtureShape["payload"] };
  assertFixtureProvenance(f as never, { sceneId: "hero-risk", requireVerified: true });
  if (!isVerifiedFixture(f as never)) throw new Error("risk fixture 必须为 verified golden");
  const p = f.payload;
  return {
    teacherName: p.teacher.name,
    courseName: p.courseName,
    blocks: p.week1Lessons.map((b) => ({ ...b })),
    rushLinks: [...p.rushWarnings].sort((a, b) => a.weekday - b.weekday),
    perWeekRisk: p.perWeekRisk.map((w) => ({ ...w })),
    totals: {
      conflictCount: p.perWeekRisk[0].conflictCount,
      rushWarningCount: p.perWeekRisk[0].rushWarningCount,
    },
  };
}