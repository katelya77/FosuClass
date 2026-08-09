export const DATA_VERSION = "competition-demo-v1" as const;

export type EntityType = "class" | "teacher" | "room" | "course" | "campus" | "college" | "user";
export type ScheduleEntityType = Extract<EntityType, "class" | "teacher" | "room" | "course">;
export type CardType = "schedule" | "classroom" | "conflict" | "day_plan" | "error" | "choice";

export type CampusToolName =
  | "resolve_entity"
  | "get_academic_context"
  | "query_schedule"
  | "find_available_classrooms"
  | "compare_schedules"
  | "generate_day_plan";

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
  dataVersion: typeof DATA_VERSION;
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
  dataVersion: typeof DATA_VERSION;
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

export interface CampusToolInputs {
  resolve_entity: ResolveEntityInput;
  get_academic_context: AcademicContextInput;
  query_schedule: QueryScheduleInput;
  find_available_classrooms: AvailableClassroomsInput;
  compare_schedules: CompareSchedulesInput;
  generate_day_plan: GenerateDayPlanInput;
}
