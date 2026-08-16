export type CompetitionDataVersion = "competition-demo-v1" | "competition-demo-v2";

// 默认数据版本常量（保留向后兼容，避免破坏旧 import）。
// 注意：运行时真实数据版本由 loadDataset() 从数据文件 meta.dataVersion 动态取得，
// 类型层以 CompetitionDataVersion 联合表示 v1/v2，不再把 Evidence/ToolEnvelope 锁死为单一 v1。
export const DATA_VERSION: CompetitionDataVersion = "competition-demo-v1";
export const DATA_VERSIONS: readonly CompetitionDataVersion[] = ["competition-demo-v1", "competition-demo-v2"];

export type EntityType = "class" | "teacher" | "room" | "course" | "campus" | "college" | "user";
export type ScheduleEntityType = Extract<EntityType, "class" | "teacher" | "room" | "course">;
export type CardType = "schedule" | "classroom" | "conflict" | "day_plan" | "error" | "choice";

export type CampusToolName =
  | "resolve_entity"
  | "get_academic_context"
  | "query_schedule"
  | "find_available_classrooms"
  | "compare_schedules"
  | "generate_day_plan"
  | "get_campus_teaching_overview";

export type CampusErrorCode =
  | "MISSING_PARAM"
  | "INVALID_PARAM"
  | "ENTITY_NOT_FOUND"
  | "AMBIGUOUS_ENTITY"
  | "OUT_OF_RANGE"
  | "EMPTY_RESULT"
  | "DATA_GUARD"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "INTERNAL";

export interface ResolvedEntity {
  type: EntityType;
  id: string;
  name: string;
}

export interface CampusToolError {
  code: CampusErrorCode;
  message: string;
  details: unknown | null;
}

export interface Evidence {
  dataVersion: CompetitionDataVersion;
  dataHash: string;
  source: "campus-tools-mcp";
  computedAt: string;
  verified: boolean;
  note?: string;
}

export interface ToolAction {
  type: string;
  label: string;
  cardType?: CardType;
  [key: string]: unknown;
}

export interface ToolEnvelope<TItem = Record<string, unknown>> {
  success: boolean;
  queryId: string;
  dataVersion: CompetitionDataVersion;
  resolvedEntity: ResolvedEntity | null;
  items: TItem[];
  actions: ToolAction[];
  evidence: Evidence;
  error: CampusToolError | null;
  [key: string]: unknown;
}

export interface TimeRangeInput {
  date?: string;
  week?: number;
  weekday?: number;
}

export interface ResolveEntityInput {
  type?: EntityType;
  name: string;
}

export interface AcademicContextInput {
  date?: string;
  dateText?: string;
  baseDate?: string;
}

export interface QueryScheduleInput extends TimeRangeInput {
  entityType: ScheduleEntityType;
  entityName: string;
  periodStart?: number;
  periodEnd?: number;
}

export interface AvailableClassroomsInput extends TimeRangeInput {
  campus?: string;
  periodStart?: number;
  periodEnd?: number;
  startPeriod?: number;
  consecutivePeriods?: number;
  building?: string;
  minCapacity?: number;
  capacity?: number;
}

export interface CompareSchedulesInput extends TimeRangeInput {
  firstType: ScheduleEntityType;
  firstName: string;
  secondType: ScheduleEntityType;
  secondName: string;
  periodStart?: number;
  periodEnd?: number;
}

export interface GenerateDayPlanInput {
  visitorId: string;
  date: string;
  preferredCampus?: string;
  preferredStudyDuration?: number;
}

/** 校园教学态势（R49 campus_overview）输入：首版固定窗口，均可选；空输入 {} 即返回固定窗口聚合。 */
export interface TeachingOverviewInput {
  windowStart?: string;
  teachingStart?: string;
  windowEnd?: string;
}

export interface CampusToolInputs {
  resolve_entity: ResolveEntityInput;
  get_academic_context: AcademicContextInput;
  query_schedule: QueryScheduleInput;
  find_available_classrooms: AvailableClassroomsInput;
  compare_schedules: CompareSchedulesInput;
  generate_day_plan: GenerateDayPlanInput;
  get_campus_teaching_overview: TeachingOverviewInput;
}
