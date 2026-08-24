/**
 * Verified competition-demo-v3 facts sourced from the deterministic CampusTools runtime.
 * These are the single source of truth for every story card and experience context rail.
 */

export interface Lesson {
  weekday: number;
  periodStart: number;
  periodEnd: number;
  startTime: string;
  endTime: string;
  className: string;
  campusName: string;
  roomName: string;
}

export interface RiskFixture {
  teacherName: string;
  courseName: string;
  windowWeeks: [number, number];
  week1Lessons: Lesson[];
  perWeekRisk: Array<{ week: number; conflictCount: number; rushWarningCount: number }>;
  rushWarnings: Array<{
    weekday: number;
    fromCampus: string;
    fromRoom: string;
    toCampus: string;
    toRoom: string;
    gapMinutes: number;
  }>;
}

export const riskFixture: RiskFixture = {
  teacherName: "教师025",
  courseName: "大学英语",
  windowWeeks: [1, 4],
  week1Lessons: [
    { weekday: 1, periodStart: 1, periodEnd: 2, startTime: "08:00", endTime: "09:40", className: "2024级环境类01班", campusName: "校区C", roomName: "C1-101" },
    { weekday: 1, periodStart: 3, periodEnd: 4, startTime: "10:00", endTime: "11:40", className: "2025级会计类01班", campusName: "校区B", roomName: "B1-103" },
    { weekday: 1, periodStart: 5, periodEnd: 6, startTime: "14:00", endTime: "15:40", className: "2024级历史类01班", campusName: "校区B", roomName: "B1-101" },
    { weekday: 2, periodStart: 1, periodEnd: 2, startTime: "08:00", endTime: "09:40", className: "2025级中文类01班", campusName: "校区B", roomName: "B1-101" },
    { weekday: 2, periodStart: 3, periodEnd: 4, startTime: "10:00", endTime: "11:40", className: "2025级生命科学类02班", campusName: "校区C", roomName: "C1-101" },
    { weekday: 2, periodStart: 5, periodEnd: 6, startTime: "14:00", endTime: "15:40", className: "2025级体育类01班", campusName: "校区D", roomName: "D1-101" },
    { weekday: 3, periodStart: 1, periodEnd: 2, startTime: "08:00", endTime: "09:40", className: "2025级计算机类01班", campusName: "校区A", roomName: "A1-201" },
    { weekday: 3, periodStart: 5, periodEnd: 6, startTime: "14:00", endTime: "15:40", className: "2025级经管类01班", campusName: "校区B", roomName: "B1-201" },
    { weekday: 4, periodStart: 1, periodEnd: 2, startTime: "08:00", endTime: "09:40", className: "2025级教育类01班", campusName: "校区D", roomName: "D1-106" },
    { weekday: 4, periodStart: 3, periodEnd: 4, startTime: "10:00", endTime: "11:40", className: "2025级计算机类02班", campusName: "校区A", roomName: "A1-101" },
    { weekday: 4, periodStart: 5, periodEnd: 6, startTime: "14:00", endTime: "15:40", className: "2024级小学教育类01班", campusName: "校区D", roomName: "D1-102" },
    { weekday: 5, periodStart: 1, periodEnd: 2, startTime: "08:00", endTime: "09:40", className: "2025级心理类01班", campusName: "校区D", roomName: "D1-101" },
    { weekday: 5, periodStart: 3, periodEnd: 4, startTime: "10:00", endTime: "11:40", className: "2025级软件类01班", campusName: "校区A", roomName: "A1-102" },
    { weekday: 5, periodStart: 5, periodEnd: 6, startTime: "14:00", endTime: "15:40", className: "2025级传播类01班", campusName: "校区B", roomName: "B1-102" },
  ],
  perWeekRisk: [
    { week: 1, conflictCount: 0, rushWarningCount: 4 },
    { week: 2, conflictCount: 0, rushWarningCount: 4 },
    { week: 3, conflictCount: 0, rushWarningCount: 4 },
    { week: 4, conflictCount: 0, rushWarningCount: 4 },
  ],
  rushWarnings: [
    { weekday: 1, fromCampus: "校区C", fromRoom: "C1-101", toCampus: "校区B", toRoom: "B1-103", gapMinutes: 20 },
    { weekday: 2, fromCampus: "校区B", fromRoom: "B1-101", toCampus: "校区C", toRoom: "C1-101", gapMinutes: 20 },
    { weekday: 4, fromCampus: "校区D", fromRoom: "D1-106", toCampus: "校区A", toRoom: "A1-101", gapMinutes: 20 },
    { weekday: 5, fromCampus: "校区D", fromRoom: "D1-101", toCampus: "校区A", toRoom: "A1-102", gapMinutes: 20 },
  ],
};

export interface CollaborationFixture {
  teachers: string[];
  slot: { week: number; weekdayName: string; date: string; timeText: string };
  commonWindows: number;
  funnel: { allRoomsAvailable: number; capacity120Plus: number };
  recommended: { name: string; building: string; campusName: string; capacity: number };
}

export const collaborationFixture: CollaborationFixture = {
  teachers: ["教师005", "教师006", "教师014"],
  slot: { week: 1, weekdayName: "周四", date: "2026-09-03", timeText: "08:00–11:40" },
  commonWindows: 1,
  funnel: { allRoomsAvailable: 63, capacity120Plus: 7 },
  recommended: { name: "A1-201", building: "A公共教学楼", campusName: "校区A", capacity: 120 },
};

export interface RescheduleFixture {
  courseName: string;
  className: string;
  teacherName: string;
  source: { week: number; weekdayName: string; periodText: string; startTime: string; endTime: string; roomName: string; campusName: string };
  target: { week: number; weekdayName: string; periodText: string; date: string };
  feasible: boolean;
  warningCount: number;
  suggestedRoom: { name: string; capacity: number; campusName: string };
  checks: Record<string, boolean>;
  warning: string;
  mutatedData: boolean;
}

export const rescheduleFixture: RescheduleFixture = {
  courseName: "数据结构",
  className: "2025级计算机类01班",
  teacherName: "教师003",
  source: { week: 1, weekdayName: "周一", periodText: "第5-6节", startTime: "14:00", endTime: "15:40", roomName: "A1-201", campusName: "校区A" },
  target: { week: 1, weekdayName: "周四", periodText: "第7-8节", date: "2026-09-03" },
  feasible: true,
  warningCount: 1,
  suggestedRoom: { name: "A1-201", capacity: 120, campusName: "校区A" },
  checks: { classConflict: false, teacherConflict: false, roomConflict: false, capacityOk: true, featureOk: true },
  warning: "调整后教师连续 4 节，可能存在连堂负荷",
  mutatedData: false,
};

export interface InsightFixture {
  windowWeeks: [number, number];
  top: Array<{ rank: number; teacher: string; lessons: number; periods: number }>;
  top1: { teacher: string; lessons: number; periods: number; weeklyLessons: number };
  risk: { conflictCount: number; rushWarningCount: number; gapMinutes: number; sampleRoute: string };
}

export const insightFixture: InsightFixture = {
  windowWeeks: [1, 4],
  top: [
    { rank: 1, teacher: "教师025", lessons: 56, periods: 112 },
    { rank: 2, teacher: "教师018", lessons: 44, periods: 88 },
    { rank: 3, teacher: "教师034", lessons: 32, periods: 64 },
    { rank: 4, teacher: "教师039", lessons: 32, periods: 64 },
  ],
  top1: { teacher: "教师025", lessons: 56, periods: 112, weeklyLessons: 14 },
  risk: { conflictCount: 0, rushWarningCount: 4, gapMinutes: 20, sampleRoute: "校区D D1-106 → 校区A A1-101" },
};
