/** Hero 场景 ViewModel —— Scene 只消费这一层，禁止深挖原始工具 JSON */

export interface RiskBlock {
  weekday: number;
  periodStart: number;
  periodEnd: number;
  startTime: string;
  endTime: string;
  className: string;
  campusName: string;
  roomName: string;
}

export interface RushLink {
  weekday: number;
  fromTime: string;
  toTime: string;
  fromCampus: string;
  fromRoom: string;
  toCampus: string;
  toRoom: string;
  gapMinutes: number;
}

export interface RiskViewModel {
  teacherName: string;
  courseName: string;
  blocks: RiskBlock[];
  rushLinks: RushLink[];
  perWeekRisk: Array<{ week: number; conflictCount: number; rushWarningCount: number }>;
  totals: { conflictCount: number; rushWarningCount: number };
}

export type ConstraintStatus = "pass" | "warn" | "fail";

export interface ConstraintRow {
  key: string;
  label: string;
  status: ConstraintStatus;
  detail: string;
}

export interface RoomInfo {
  name: string;
  capacity: number;
  building?: string;
  campusName?: string;
  type?: string;
}

export interface CollaborationViewModel {
  participants: string[];
  slot: { weekday: number; weekdayName: string; date: string; periodText: string; timeText: string };
  /** 每位教师在上午（P1..4）× 周一..周五 的忙碌块（真实课次投影） */
  lanes: Array<{ teacher: string; busy: Array<{ weekday: number; periodStart: number; periodEnd: number }>}>;
  funnel: { allRoomsAvailable: number; capacity120Plus: number };
  candidatesCap120: RoomInfo[];
  recommended: RoomInfo & { building: string };
}

export interface RescheduleViewModel {
  courseName: string;
  className: string;
  teacherName: string;
  source: { weekdayName: string; weekday: number; periodText: string; startTime: string; roomName: string; building: string; campusName: string };
  target: { weekdayName: string; weekday: number; periodText: string; date: string };
  constraints: ConstraintRow[];
  autoResolve: { feasible: boolean; spaceRoomCount: number; suggested: RoomInfo };
  explicitRoom: RoomInfo;
  warningText: string;
  feasible: true;
  mutatedData: false;
  candidateNames: string[];
}

export interface InsightRankRow {
  rank: number;
  teacherId: string;
  lessons: number;
  periods: number;
  tied: boolean;
}

export interface InsightViewModel {
  windowLabel: string;
  ranking: InsightRankRow[];
  top1: { name: string; lessons: number; periods: number };
  drilldownWeeks: Array<{ week: number; lessons: number }>;
  riskSummary: { conflictCount: number; rushWarningCount: number; gapMinutes: number; sampleRoute: string };
}