import insightFixture from "../../fixtures/heroes/insight.json";
import { assertFixtureProvenance } from "../provenance/validate";
import type { InsightViewModel } from "./types";

/** 全局洞察 —— 排名 / Top1 身份 / 下钻证据 */
export function buildInsightViewModel(): InsightViewModel {
  const f = insightFixture;
  assertFixtureProvenance(f as never, { sceneId: "hero-insight", requireVerified: true });
  const p = f.payload;
  if (p.rankingTop10[0].teacherId !== p.top1.name) {
    throw new Error("insight fixture 语义错误：Top1 与排行首位不一致");
  }
  return {
    windowLabel: "第 " + p.windowWeeks[0] + "–" + p.windowWeeks[1] + " 周",
    ranking: p.rankingTop10.map((r) => ({ ...r })),
    top1: { ...p.top1 },
    drilldownWeeks: p.drilldownWeeks.map((w) => ({ ...w })),
    riskSummary: { ...p.riskSummary },
  };
}