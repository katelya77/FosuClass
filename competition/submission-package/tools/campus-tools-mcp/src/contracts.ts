export type CompetitionDataVersion = "competition-demo-v1" | "competition-demo-v2" | "competition-demo-v3";

// 默认数据版本常量（保留向后兼容，避免破坏旧 import）。
// 注意：运行时真实数据版本由 loadDataset() 从数据文件 meta.dataVersion 动态取得，
// 类型层以 CompetitionDataVersion 联合表示 v1/v2/v3，不再把 Evidence/ToolEnvelope 锁死为单一版本。
export const DATA_VERSION: CompetitionDataVersion = "competition-demo-v1";
export const DATA_VERSIONS: readonly CompetitionDataVersion[] = ["competition-demo-v1", "competition-demo-v2", "competition-demo-v3"];

export type EntityType = "class" | "teacher" | "room" | "course" | "campus" | "college" | "user";
export type ScheduleEntityType = Extract<EntityType, "class" | "teacher" | "room" | "course">;
export type CardType = "schedule" | "classroom" | "conflict" | "day_plan" | "error" | "choice";

export type CampusToolName =
  | "resolve_entity"
  | "get_academic_context"
  | "query_schedule"
  | "query_schedule_range"
  | "find_available_classrooms"
  | "compare_schedules"
  | "generate_day_plan"
  | "get_campus_teaching_overview"
  | "query_teacher_load"
  | "query_entity_search"
  | "query_common_free_time"
  | "query_room_utilization"
  | "check_reschedule_feasibility"
  | "plan_group";

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

export type TemporalIntentKind =
  | "absolute"
  | "relative_day"
  | "relative_weekday"
  | "academic_week"
  | "academic_week_weekday"
  | "week_range"
  | "future_weeks"
  | "recent_weeks"
  | "next_week"
  | "prev_week"
  | "current";

/** 结构化 temporal intent（Temporal Semantic Core 输入）。 */
export interface TemporalIntent {
  kind: TemporalIntentKind;
  date?: string;
  offset?: number;
  weekday?: number;
  week?: number;
  weekStart?: number;
  weekEnd?: number;
  count?: number;
}

/** R50.0：temporalContext（由 temporal-core 确定性解析，内部协议不默认展示给用户）。 */
export interface TemporalContext {
  referenceDate: string | null;
  semesterId: string | null;
  inSemester: boolean;
  currentAcademicWeek: number | null;
  resolvedDate: string | null;
  resolvedWeek: number | null;
  resolvedWeekStart: number | null;
  resolvedWeekEnd: number | null;
  resolutionKind: string;
  note?: string;
}

export interface AcademicContextInput {
  intent?: TemporalIntent | string;
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

/** 多教学周课表展开（R49.4）输入：weekStart/weekEnd 必填；weekday/节次可选（0 视为未指定）。 */
export interface QueryScheduleRangeInput {
  entityType: ScheduleEntityType;
  entityName: string;
  weekStart: number;
  weekEnd: number;
  weekday?: number;
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

/** 教师课表负载窗口聚合（R49.4）输入：weekStart/weekEnd 必填；topN、campus 可选。 */
export interface QueryTeacherLoadInput {
  weekStart: number;
  weekEnd: number;
  topN?: number;
  campus?: string;
}

export interface NamedEntityInput {
  type: "teacher" | "class";
  name: string;
}

/** R50.0 实体搜索：matchType 由服务端确定性判定（exact/normalized_exact/prefix/substring/fuzzy/list）。 */
export interface QueryEntitySearchInput {
  entityType?: EntityType;
  keyword?: string;
  campus?: string;
  college?: string;
  limit?: number;
}

/** R50.0 多实体共同空闲：entities[2..6] + week 或 weekStart/weekEnd。 */
export interface QueryCommonFreeTimeInput {
  entities: NamedEntityInput[];
  week?: number;
  weekStart?: number;
  weekEnd?: number;
  weekday?: number;
  weekdays?: number[];
  periodStart?: number;
  periodEnd?: number;
  minConsecutivePeriods?: number;
  limit?: number;
}

/** R50.0 教室利用率：groupBy room|building|campus，sort highest|lowest，Ranking Core 排名。 */
export interface QueryRoomUtilizationInput {
  weekStart: number;
  weekEnd: number;
  campus?: string;
  building?: string;
  roomType?: string;
  groupBy?: "room" | "building" | "campus";
  sort?: "highest" | "lowest";
  topN?: number;
}

/** R50.0 调课 What-if：sourceLessonId + target{week,weekday,periodStart,periodEnd,room?}。 */
export interface CheckRescheduleFeasibilityInput {
  sourceLessonId: string;
  target: {
    week: number;
    weekday: number;
    periodStart: number;
    periodEnd: number;
    room?: string;
  };
}

/** R50.0 群体计划：共同空闲 + 空教室 + 容量/设备过滤 ranked 候选。 */
export interface PlanGroupInput {
  entities: NamedEntityInput[];
  week: number;
  campus?: string;
  weekday?: number;
  weekdays?: number[];
  periodStart?: number;
  periodEnd?: number;
  minConsecutivePeriods?: number;
  minCapacity?: number;
  requiredFeatures?: string[];
}

export interface CampusToolInputs {
  resolve_entity: ResolveEntityInput;
  get_academic_context: AcademicContextInput;
  query_schedule: QueryScheduleInput;
  query_schedule_range: QueryScheduleRangeInput;
  find_available_classrooms: AvailableClassroomsInput;
  compare_schedules: CompareSchedulesInput;
  generate_day_plan: GenerateDayPlanInput;
  get_campus_teaching_overview: TeachingOverviewInput;
  query_teacher_load: QueryTeacherLoadInput;
  query_entity_search: QueryEntitySearchInput;
  query_common_free_time: QueryCommonFreeTimeInput;
  query_room_utilization: QueryRoomUtilizationInput;
  check_reschedule_feasibility: CheckRescheduleFeasibilityInput;
  plan_group: PlanGroupInput;
}
