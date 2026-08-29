import { placeholderFixture, type PlaceholderFixture } from "../data/types/fixture";

/**
 * Hero 场景共享占位载荷。
 * 数值锚点来自 competition/adp-kit/reports/current-adp-checkpoint.md 中
 * 已记录的真机实测事实（R49.2/R49.4/R50 证据），但 Phase 2 前仍按纪律标记为
 * placeholder —— 等 Runtime Golden 导出管线落地后替换为 VerifiedFixture。
 */
export interface HeroesPayload {
  /** T09 week1 赶场间隔（分钟）—— checkpoint 记录 rushWarningCount=1，lesson-051→052 仅隔 20 分钟 */
  riskGapMinutes: number;
  /** 冲突说明 */
  conflictNote: string;
  /** 教师009 第1–4周负载（checkpoint：27 次授课 / 54 课时，Top1 与教师011 并列后按稳定排序） */
  topLoad: { rank: 1 | 2; teacherId: string; lessons: number; periods: number };
  secondLoad: { rank: 2; teacherId: string; lessons: number; periods: number };
  /** 校区A 容量≥60 的可用教室数（真机实测 8 间） */
  roomsCapacity60Plus: number;
  /** 两教师共同空闲窗口数（第1周，真机冒烟 8 个窗口） */
  commonFreeWindowsWeek1: number;
}

export const heroesFixture: PlaceholderFixture<HeroesPayload> = placeholderFixture({
  sceneId: "hero-*",
  provenanceNote:
    "数值锚点见 current-adp-checkpoint.md（R49.2 真机证据 / R49.4 远程复测 / R50 smoke）；Phase 2 由 Golden 导出替换并逐项核验",
  payload: {
    riskGapMinutes: 20,
    conflictNote: "lesson-018 与 lesson-051 同一时段重叠",
    topLoad: { rank: 1, teacherId: "教师009", lessons: 27, periods: 54 },
    secondLoad: { rank: 2, teacherId: "教师011", lessons: 27, periods: 54 },
    roomsCapacity60Plus: 8,
    commonFreeWindowsWeek1: 8,
  },
});
