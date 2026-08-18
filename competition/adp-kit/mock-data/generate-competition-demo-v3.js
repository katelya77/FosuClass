#!/usr/bin/env node
/**
 * competition-demo-v3 匿名演示数据生成器
 *
 * 用途：为腾讯云 ADP 参赛智能体「校园智序 · 小序」生成完全虚构、自洽的校园演示数据（V3）。
 *
 * 设计原则：
 * 1. 全部实体为匿名虚构：校区A/B/C/D、学院（工程与计算类/基础科学类/生命与环境类/人文与设计类/
 *    经管与公共类/教育与体育类）、2025级计算机类01班 等合成专业簇、教师001..教师040、演示用户001..
 *    不对应任何真实学校、学院、教师、学生与团队成员；不使用任何现实校名/院名/真人姓名。
 * 2. 数据由下方 LESSON_TABLE 规则表确定性展开，无随机数，重复生成结果完全一致（byte-stable）。
 * 3. 数据必须自洽并通过 validate-competition-demo-v3.js 校验：
 *    引用完整、硬冲突仅限设计白名单（4 条）、周次/节次合法、容量与教室 feature 覆盖、匿名、设计场景存在。
 * 4. 教室自动分配：LESSON_TABLE 中未显式指定 room 的条目，由生成器按「容量≥班级规模 + features 覆盖
 *    课程 requiredFeatures + 该 slot 未被占用」确定性挑选（按 room id 升序取第一个可用），保证无意外
 *    教室冲突；关键场景（跨校区赶场、设计冲突、体育场地、大班教室、机房/实验室）显式钉死 room。
 * 5. 生成器内置硬冲突自检：展开后统计 teacher/class/room 冲突，必须与 EXPECTED_CONFLICT_KEYS 完全一致，
 *    否则抛错并打印差异，防止意外冲突混入。
 *
 * 内置设计场景（供工作流调试与评测用例锚定，见 meta.designedScenarios g01~g20）：
 * - g01 单教师同时段冲突：teacher-012 周二5-6 计算思维 + 信息素养
 * - g02 班级冲突：class-life-01 周五5-6 普通生物学 + 生物实验
 * - g03 教室冲突：room-a-101 周四5-6 统计学 + 电路基础
 * - g04 20分钟跨校区赶场：teacher-003 周一 A→B（数据结构5-6@A → 程序设计7-8@B，A→B=20min）
 * - g05 足够时间跨校区非风险：teacher-030 周三 C→D（市场分析5-6@C → 电子商务7-8@D，C→D=10min）
 * - g06 连续4节实验：chem-01 无机化学实验 周三3-6
 * - g07 高负载教师：teacher-039 8 条体育
 * - g08 低负载教师：teacher-038 仅教学实习 1 条
 * - g09 高利用率教室：room-a-101 同一 slot 两条 + 多 slot 复用
 * - g10 低利用率教室：存在课时数极少（<=2）的教室
 * - g11 多教师共同空闲：teacher-005 / teacher-006 / teacher-014 周四上午均空闲
 * - g12 无共同空闲：teacher-012 / teacher-013 周四下午互相占满（5-6 vs 7-8）
 * - g13 容量分级：60/100/120 教室 + 班级规模 38~120 多样
 * - g14 feature 匹配/不匹配：reschedule_feasibility 用（数据内始终 feature 一致）
 * - g15 晚间课：biz-01 电子商务 周五9-10
 * - g16 周末课：bio-01 生物信息学 周六1-2
 * - g17 单双周差异：多门课 单/双周 交替
 * - g18 跨周不规则：psych-01 研讨课 1-4,7-10 周
 * - g19 group_plan 多候选 / 无候选：空闲教室 + 共同空闲资源供规划检索
 * - g20 调课可行 / 调课冲突：reschedule_feasibility 正负样例（数据自洽）
 *
 * 运行：node generate-competition-demo-v3.js
 * 输出：competition-demo-v3.json（同目录）
 */

const fs = require("fs");
const path = require("path");
const { computeDataHash } = require("./data-hash");

const DATA_VERSION = "competition-demo-v3";
const SEMESTER_START_DATE = "2026-08-31";
const TOTAL_WEEKS = 20;

function addCalendarDays(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + Number(days) * 86400000)
    .toISOString()
    .slice(0, 10);
}

const SEMESTER_END_DATE = addCalendarDays(SEMESTER_START_DATE, TOTAL_WEEKS * 7 - 1);

// ---------------------------------------------------------------------------
// 元信息：学期与节次时间轴 + 设计场景
// ---------------------------------------------------------------------------
const META = {
  dataVersion: DATA_VERSION,
  schema: "campus-demo/v3",
  timezone: "Asia/Shanghai",
  // 只用于固定评测基准；真实请求默认按 Asia/Shanghai 当前日期解析。
  demoReferenceDate: SEMESTER_START_DATE,
  generatedBy: "competition/adp-kit/mock-data/generate-competition-demo-v3.js",
  anonymization:
    "本数据集全部为虚构匿名演示数据，不对应任何真实学校、学院、教师、学生、用户与团队身份。",
  semester: {
    id: "2026-2027-1",
    name: "2026-2027学年第一学期",
    startDate: SEMESTER_START_DATE,
    endDate: SEMESTER_END_DATE,
    totalWeeks: TOTAL_WEEKS,
  },
  // 节次时间轴：1-10 节，两节为一大节
  periods: [
    { period: 1, start: "08:00", end: "08:45" },
    { period: 2, start: "08:55", end: "09:40" },
    { period: 3, start: "10:00", end: "10:45" },
    { period: 4, start: "10:55", end: "11:40" },
    { period: 5, start: "14:00", end: "14:45" },
    { period: 6, start: "14:55", end: "15:40" },
    { period: 7, start: "16:00", end: "16:45" },
    { period: 8, start: "16:55", end: "17:40" },
    { period: 9, start: "19:00", end: "19:45" },
    { period: 10, start: "19:55", end: "20:40" },
  ],
  weekdayNames: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  // 设计场景锚点（供评测用例 / 工作流调试 / 数据质量报告引用）
  designedScenarios: [
    { id: "g01", name: "single-teacher-conflict", description: "teacher-012 周二5-6 同时上计算思维与信息素养（单教师硬冲突）" },
    { id: "g02", name: "class-conflict", description: "class-life-01 周五5-6 同时上普通生物学与生物实验（班级硬冲突）" },
    { id: "g03", name: "room-conflict", description: "room-a-101 周四5-6 同时容纳统计学与电路基础（教室硬冲突）" },
    { id: "g04", name: "cross-campus-rush-20min", description: "teacher-003 周一 5-6@校区A 数据结构 → 7-8@校区B 程序设计（A→B=20分钟赶场）" },
    { id: "g05", name: "cross-campus-enough-gap", description: "teacher-030 周三 5-6@校区C 市场分析 → 7-8@校区D 电子商务（C→D=10分钟，间隔20分钟非风险）" },
    { id: "g06", name: "consecutive-4-periods-lab", description: "chem-01 无机化学实验 周三3-6 连续4节实验" },
    { id: "g07", name: "high-load-teacher", description: "teacher-039 承担 8 条体育课（高负载教师）" },
    { id: "g08", name: "low-load-teacher", description: "teacher-038 仅承担 1 条教学实习（低负载教师）" },
    { id: "g09", name: "high-utilization-room", description: "room-a-101 同一 slot 两条且多 slot 复用（高利用率教室）" },
    { id: "g10", name: "low-utilization-room", description: "存在课时数<=2 的教室（低利用率教室样例）" },
    { id: "g11", name: "multi-teacher-common-free", description: "teacher-005/teacher-006/teacher-014 周四上午均空闲（共同空闲阳性）" },
    { id: "g12", name: "no-common-free", description: "teacher-012/teacher-013 周四下午 5-6 与 7-8 互相占满（无共同空闲）" },
    { id: "g13", name: "capacity-tiered", description: "60/100/120 容量教室 + 38~120 班级规模分级筛选" },
    { id: "g14", name: "feature-match", description: "课程 requiredFeatures 与教室 features 一致；reschedule_feasibility 可构造不匹配样例" },
    { id: "g15", name: "evening-course", description: "biz-01 电子商务 周五9-10 晚间课" },
    { id: "g16", name: "weekend-course", description: "bio-01 生物信息学 周六1-2 周末课" },
    { id: "g17", name: "odd-even-weeks", description: "单/双周交替课程（如 1-16(单)、1-8(双)）" },
    { id: "g18", name: "irregular-cross-week", description: "psych-01 研讨课 1-4,7-10 周跨周不规则" },
    { id: "g19", name: "group-plan-candidates", description: "共同空闲+空教室+容量+设备需求 的 group_plan 多候选/无候选资源" },
    { id: "g20", name: "reschedule-feasibility", description: "调课可行 / 调课教师冲突 / 调课教室冲突 / 调课容量不足 的正负样例数据基础" },
  ],
};

// ---------------------------------------------------------------------------
// 校区 / 学院 / 校区间通勤矩阵
// ---------------------------------------------------------------------------
const CAMPUSES = [
  { id: "campus-a", name: "校区A", buildings: ["A综合教学楼", "A公共教学楼", "A基础实验楼", "A工程实践楼", "A创新中心", "A体育场馆"] },
  { id: "campus-b", name: "校区B", buildings: ["B综合教学楼", "B公共教学楼", "B基础实验楼", "B工程实践楼", "B创新中心", "B体育场馆"] },
  { id: "campus-c", name: "校区C", buildings: ["C综合教学楼", "C公共教学楼", "C基础实验楼", "C工程实践楼", "C创新中心", "C体育场馆"] },
  { id: "campus-d", name: "校区D", buildings: ["D综合教学楼", "D公共教学楼", "D基础实验楼", "D工程实践楼", "D创新中心", "D体育场馆"] },
];

// 确定性跨校区通勤矩阵（分钟级，非现实地图；对称）。
// A→B=20（g04 赶场风险）、C→D=10（g05 足够时间非风险）、B→C=12。
const CAMPUS_TRAVEL_MATRIX = {
  unit: "minutes",
  matrix: {
    "campus-a": { "campus-b": 20, "campus-c": 30, "campus-d": 45 },
    "campus-b": { "campus-a": 20, "campus-c": 12, "campus-d": 28 },
    "campus-c": { "campus-a": 30, "campus-b": 12, "campus-d": 10 },
    "campus-d": { "campus-a": 45, "campus-b": 28, "campus-c": 10 },
  },
};

const COLLEGES = [
  { id: "college-cs", name: "工程与计算类" },
  { id: "college-sci", name: "基础科学类" },
  { id: "college-life", name: "生命与环境类" },
  { id: "college-hum", name: "人文与设计类" },
  { id: "college-bus", name: "经管与公共类" },
  { id: "college-edu", name: "教育与体育类" },
];

// ---------------------------------------------------------------------------
// 班级（24 个，规模 38~120，覆盖 4 校区 / 6 学院，全合成专业簇）
// ---------------------------------------------------------------------------
const CLASSES = [
  // ---- 校区A：工程与计算 + 基础科学 ----
  { id: "class-cs-01", name: "2025级计算机类01班", collegeId: "college-cs", campusId: "campus-a", size: 120 },
  { id: "class-cs-02", name: "2025级计算机类02班", collegeId: "college-cs", campusId: "campus-a", size: 56 },
  { id: "class-sw-01", name: "2025级软件类01班", collegeId: "college-cs", campusId: "campus-a", size: 48 },
  { id: "class-me-01", name: "2024级机械类01班", collegeId: "college-cs", campusId: "campus-a", size: 48 },
  { id: "class-math-01", name: "2025级数学类01班", collegeId: "college-sci", campusId: "campus-a", size: 52 },
  { id: "class-phy-01", name: "2025级物理类01班", collegeId: "college-sci", campusId: "campus-a", size: 46 },
  { id: "class-chem-01", name: "2025级化学类01班", collegeId: "college-sci", campusId: "campus-a", size: 48 },
  { id: "class-stat-01", name: "2024级统计类01班", collegeId: "college-sci", campusId: "campus-a", size: 46 },
  // ---- 校区B：人文与设计 + 经管与公共 ----
  { id: "class-chi-01", name: "2025级中文类01班", collegeId: "college-hum", campusId: "campus-b", size: 55 },
  { id: "class-jour-01", name: "2025级传播类01班", collegeId: "college-hum", campusId: "campus-b", size: 44 },
  { id: "class-design-01", name: "2025级设计类01班", collegeId: "college-hum", campusId: "campus-b", size: 44 },
  { id: "class-hist-01", name: "2024级历史类01班", collegeId: "college-hum", campusId: "campus-b", size: 44 },
  { id: "class-biz-01", name: "2025级经管类01班", collegeId: "college-bus", campusId: "campus-b", size: 90 },
  { id: "class-econ-01", name: "2025级经济类01班", collegeId: "college-bus", campusId: "campus-b", size: 48 },
  { id: "class-acct-01", name: "2025级会计类01班", collegeId: "college-bus", campusId: "campus-b", size: 45 },
  { id: "class-pub-01", name: "2024级公共类01班", collegeId: "college-bus", campusId: "campus-b", size: 44 },
  // ---- 校区C：生命与环境 ----
  { id: "class-life-01", name: "2025级生命科学类01班", collegeId: "college-life", campusId: "campus-c", size: 100 },
  { id: "class-life-02", name: "2025级生命科学类02班", collegeId: "college-life", campusId: "campus-c", size: 48 },
  { id: "class-bio-01", name: "2025级生物类01班", collegeId: "college-life", campusId: "campus-c", size: 46 },
  { id: "class-env-01", name: "2024级环境类01班", collegeId: "college-life", campusId: "campus-c", size: 45 },
  // ---- 校区D：教育与体育 ----
  { id: "class-edu-01", name: "2025级教育类01班", collegeId: "college-edu", campusId: "campus-d", size: 72 },
  { id: "class-pe-01", name: "2025级体育类01班", collegeId: "college-edu", campusId: "campus-d", size: 40 },
  { id: "class-psych-01", name: "2025级心理类01班", collegeId: "college-edu", campusId: "campus-d", size: 42 },
  { id: "class-prim-01", name: "2024级小学教育类01班", collegeId: "college-edu", campusId: "campus-d", size: 38 },
];

// ---------------------------------------------------------------------------
// 教师（40 位：teacher-001..040 / 教师001..教师040）
// 关键角色：teacher-012（g01 冲突）、teacher-019（g02/g04 冲突）、teacher-003（g04 赶场）、
//           teacher-030（g05 赶场）、teacher-025（英语 14 门分散）、teacher-033/034/035/039（体育分散）、
//           teacher-038（低负载）、teacher-005/006/014（g11 共同空闲）、teacher-012/013（g12 无共同空闲）。
// ---------------------------------------------------------------------------
const TEACHERS = [
  { id: "teacher-001", name: "教师001", collegeId: "college-sci", title: "教授" },
  { id: "teacher-002", name: "教师002", collegeId: "college-sci", title: "副教授" },
  { id: "teacher-003", name: "教师003", collegeId: "college-cs", title: "教授" },
  { id: "teacher-004", name: "教师004", collegeId: "college-cs", title: "副教授" },
  { id: "teacher-005", name: "教师005", collegeId: "college-sci", title: "副教授" },
  { id: "teacher-006", name: "教师006", collegeId: "college-cs", title: "讲师" },
  { id: "teacher-007", name: "教师007", collegeId: "college-cs", title: "讲师" },
  { id: "teacher-008", name: "教师008", collegeId: "college-cs", title: "讲师" },
  { id: "teacher-009", name: "教师009", collegeId: "college-cs", title: "副教授" },
  { id: "teacher-010", name: "教师010", collegeId: "college-cs", title: "讲师" },
  { id: "teacher-011", name: "教师011", collegeId: "college-sci", title: "教授" },
  { id: "teacher-012", name: "教师012", collegeId: "college-sci", title: "副教授" },
  { id: "teacher-013", name: "教师013", collegeId: "college-sci", title: "讲师" },
  { id: "teacher-014", name: "教师014", collegeId: "college-sci", title: "副教授" },
  { id: "teacher-015", name: "教师015", collegeId: "college-hum", title: "教授" },
  { id: "teacher-016", name: "教师016", collegeId: "college-hum", title: "副教授" },
  { id: "teacher-017", name: "教师017", collegeId: "college-hum", title: "讲师" },
  { id: "teacher-018", name: "教师018", collegeId: "college-hum", title: "副教授" },
  { id: "teacher-019", name: "教师019", collegeId: "college-life", title: "副教授" },
  { id: "teacher-020", name: "教师020", collegeId: "college-bus", title: "教授" },
  { id: "teacher-021", name: "教师021", collegeId: "college-bus", title: "副教授" },
  { id: "teacher-022", name: "教师022", collegeId: "college-bus", title: "副教授" },
  { id: "teacher-023", name: "教师023", collegeId: "college-bus", title: "讲师" },
  { id: "teacher-024", name: "教师024", collegeId: "college-bus", title: "讲师" },
  { id: "teacher-025", name: "教师025", collegeId: "college-edu", title: "副教授" },
  { id: "teacher-026", name: "教师026", collegeId: "college-life", title: "教授" },
  { id: "teacher-027", name: "教师027", collegeId: "college-life", title: "副教授" },
  { id: "teacher-028", name: "教师028", collegeId: "college-life", title: "讲师" },
  { id: "teacher-029", name: "教师029", collegeId: "college-life", title: "副教授" },
  { id: "teacher-030", name: "教师030", collegeId: "college-bus", title: "讲师" },
  { id: "teacher-031", name: "教师031", collegeId: "college-life", title: "讲师" },
  { id: "teacher-032", name: "教师032", collegeId: "college-edu", title: "教授" },
  { id: "teacher-033", name: "教师033", collegeId: "college-edu", title: "讲师" },
  { id: "teacher-034", name: "教师034", collegeId: "college-edu", title: "讲师" },
  { id: "teacher-035", name: "教师035", collegeId: "college-edu", title: "讲师" },
  { id: "teacher-036", name: "教师036", collegeId: "college-edu", title: "讲师" },
  { id: "teacher-037", name: "教师037", collegeId: "college-edu", title: "副教授" },
  { id: "teacher-038", name: "教师038", collegeId: "college-edu", title: "讲师" },
  { id: "teacher-039", name: "教师039", collegeId: "college-edu", title: "讲师" },
  { id: "teacher-040", name: "教师040", collegeId: "college-edu", title: "副教授" },
];

// ---------------------------------------------------------------------------
// 课程（73 门：course-001..073，覆盖公共基础/工程/生命/人文/经管/教育/实践）
// requiredFeatures 与教室 features 严格一致（validator 会校验覆盖关系）。
// 大班课（程序设计/数据结构/高等数学/市场分析/电子商务/统计学等）features 只用投影+智慧屏，
// 避免 120 人大班无法进 60 人机房/实验室的容量矛盾；机房/实验类课程单独成课。
// ---------------------------------------------------------------------------
const COURSES = [
  // ---- 工程与计算（college-cs）----
  { id: "course-001", name: "程序设计", collegeId: "college-cs", credits: 4, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 120 },
  { id: "course-002", name: "数据结构", collegeId: "college-cs", credits: 4, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 120 },
  { id: "course-003", name: "数据库原理", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "computer_lab"], expectedSize: 56 },
  { id: "course-004", name: "操作系统", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 56 },
  { id: "course-005", name: "计算机网络", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "computer_lab"], expectedSize: 48 },
  { id: "course-006", name: "软件工程导论", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 48 },
  { id: "course-007", name: "工程制图", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 48 },
  { id: "course-008", name: "机械基础", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 48 },
  { id: "course-009", name: "自动控制原理", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 46 },
  { id: "course-010", name: "计算思维", collegeId: "college-cs", credits: 2, category: "必修", courseType: "lecture", requiredFeatures: ["computer_lab", "projector"], expectedSize: 56 },
  { id: "course-011", name: "信息素养", collegeId: "college-cs", credits: 2, category: "必修", courseType: "lecture", requiredFeatures: ["computer_lab", "projector"], expectedSize: 52 },
  { id: "course-012", name: "电路基础", collegeId: "college-cs", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 46 },
  { id: "course-013", name: "工程实践", collegeId: "college-cs", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["computer_lab"], expectedSize: 48 },
  { id: "course-014", name: "创新训练", collegeId: "college-cs", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["seminar", "studio"], expectedSize: 44 },
  { id: "course-015", name: "数据结构实验", collegeId: "college-cs", credits: 1, category: "实验", courseType: "lab", requiredFeatures: ["computer_lab"], expectedSize: 48 },
  { id: "course-016", name: "程序设计实验", collegeId: "college-cs", credits: 1, category: "实验", courseType: "lab", requiredFeatures: ["computer_lab"], expectedSize: 56 },
  // ---- 基础科学（college-sci）----
  { id: "course-017", name: "高等数学A", collegeId: "college-sci", credits: 5, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 120 },
  { id: "course-018", name: "高等数学B", collegeId: "college-sci", credits: 5, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 90 },
  { id: "course-019", name: "线性代数", collegeId: "college-sci", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 90 },
  { id: "course-020", name: "概率统计", collegeId: "college-sci", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 48 },
  { id: "course-021", name: "大学物理", collegeId: "college-sci", credits: 4, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 90 },
  { id: "course-022", name: "物理实验", collegeId: "college-sci", credits: 1, category: "实验", courseType: "lab", requiredFeatures: ["wet_lab", "projector"], expectedSize: 46 },
  { id: "course-023", name: "化学原理", collegeId: "college-sci", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 48 },
  { id: "course-024", name: "无机化学实验", collegeId: "college-sci", credits: 2, category: "实验", courseType: "lab", requiredFeatures: ["wet_lab"], expectedSize: 48 },
  { id: "course-025", name: "有机化学", collegeId: "college-sci", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 48 },
  { id: "course-026", name: "数学建模", collegeId: "college-sci", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["computer_lab", "projector"], expectedSize: 52 },
  { id: "course-027", name: "统计学", collegeId: "college-sci", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 48 },
  { id: "course-028", name: "学术写作", collegeId: "college-sci", credits: 2, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 44 },
  // ---- 生命与环境（college-life）----
  { id: "course-029", name: "普通生物学", collegeId: "college-life", credits: 4, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 100 },
  { id: "course-030", name: "生物化学", collegeId: "college-life", credits: 4, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 48 },
  { id: "course-031", name: "遗传学基础", collegeId: "college-life", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 46 },
  { id: "course-032", name: "动物生理学", collegeId: "college-life", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 46 },
  { id: "course-033", name: "生态学基础", collegeId: "college-life", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 46 },
  { id: "course-034", name: "实验技能", collegeId: "college-life", credits: 2, category: "实验", courseType: "lab", requiredFeatures: ["wet_lab"], expectedSize: 48 },
  { id: "course-035", name: "生物实验", collegeId: "college-life", credits: 2, category: "实验", courseType: "lab", requiredFeatures: ["wet_lab"], expectedSize: 100 },
  { id: "course-036", name: "化学实验", collegeId: "college-life", credits: 2, category: "实验", courseType: "lab", requiredFeatures: ["wet_lab"], expectedSize: 45 },
  { id: "course-037", name: "环境工程实验", collegeId: "college-life", credits: 2, category: "实验", courseType: "lab", requiredFeatures: ["wet_lab"], expectedSize: 45 },
  { id: "course-038", name: "环境监测", collegeId: "college-life", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 45 },
  { id: "course-039", name: "微生物学", collegeId: "college-life", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "wet_lab"], expectedSize: 48 },
  { id: "course-040", name: "生物信息学", collegeId: "college-life", credits: 2, category: "选修", courseType: "lecture", requiredFeatures: ["computer_lab", "projector"], expectedSize: 46 },
  { id: "course-041", name: "生态学野外实践", collegeId: "college-life", credits: 2, category: "实践", courseType: "practice", requiredFeatures: [], expectedSize: 46 },
  { id: "course-042", name: "毕业设计指导", collegeId: "college-life", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["projector", "smart_board"], expectedSize: 40 },
  // ---- 人文与设计（college-hum）----
  { id: "course-043", name: "现代汉语", collegeId: "college-hum", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 55 },
  { id: "course-044", name: "中国文学", collegeId: "college-hum", credits: 4, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 55 },
  { id: "course-045", name: "传播基础", collegeId: "college-hum", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 50 },
  { id: "course-046", name: "新闻采访与写作", collegeId: "college-hum", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "recording"], expectedSize: 50 },
  { id: "course-047", name: "学术阅读", collegeId: "college-hum", credits: 2, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 44 },
  { id: "course-048", name: "视觉传达设计", collegeId: "college-hum", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["studio", "projector"], expectedSize: 44 },
  { id: "course-049", name: "中国历史通论", collegeId: "college-hum", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 44 },
  { id: "course-050", name: "文化创意产业", collegeId: "college-hum", credits: 2, category: "选修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 42 },
  { id: "course-051", name: "摄影与摄像", collegeId: "college-hum", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["studio", "recording"], expectedSize: 40 },
  { id: "course-052", name: "播音与主持", collegeId: "college-hum", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["studio", "recording"], expectedSize: 40 },
  { id: "course-053", name: "设计软件应用", collegeId: "college-hum", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["computer_lab", "studio"], expectedSize: 44 },
  { id: "course-054", name: "媒体伦理", collegeId: "college-hum", credits: 2, category: "选修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 42 },
  // ---- 经管与公共（college-bus）----
  { id: "course-055", name: "管理学", collegeId: "college-bus", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 90 },
  { id: "course-056", name: "经济学基础", collegeId: "college-bus", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 90 },
  { id: "course-057", name: "市场分析", collegeId: "college-bus", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 90 },
  { id: "course-058", name: "会计学", collegeId: "college-bus", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 48 },
  { id: "course-059", name: "电子商务", collegeId: "college-bus", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 90 },
  { id: "course-060", name: "公共管理", collegeId: "college-bus", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 44 },
  { id: "course-061", name: "金融学基础", collegeId: "college-bus", credits: 2, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 45 },
  { id: "course-062", name: "商务英语", collegeId: "college-bus", credits: 2, category: "选修", courseType: "lecture", requiredFeatures: ["language_lab", "projector"], expectedSize: 40 },
  { id: "course-063", name: "市场营销", collegeId: "college-bus", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 44 },
  { id: "course-064", name: "数据分析实务", collegeId: "college-bus", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["computer_lab"], expectedSize: 46 },
  { id: "course-065", name: "经济学原理", collegeId: "college-bus", credits: 3, category: "选修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 44 },
  // ---- 教育与体育（college-edu）----
  { id: "course-066", name: "大学英语", collegeId: "college-edu", credits: 4, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 60 },
  { id: "course-067", name: "大学体育", collegeId: "college-edu", credits: 1, category: "必修", courseType: "pe", requiredFeatures: ["movable_seats"], expectedSize: 120 },
  { id: "course-068", name: "教育学", collegeId: "college-edu", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 72 },
  { id: "course-069", name: "心理学基础", collegeId: "college-edu", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 42 },
  { id: "course-070", name: "课程设计", collegeId: "college-edu", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector", "smart_board"], expectedSize: 72 },
  { id: "course-071", name: "教学实习", collegeId: "college-edu", credits: 2, category: "实践", courseType: "practice", requiredFeatures: ["projector", "smart_board"], expectedSize: 72 },
  { id: "course-072", name: "研讨课", collegeId: "college-edu", credits: 2, category: "选修", courseType: "seminar", requiredFeatures: ["seminar", "movable_seats"], expectedSize: 42 },
  { id: "course-073", name: "运动生理学", collegeId: "college-edu", credits: 3, category: "必修", courseType: "lecture", requiredFeatures: ["projector"], expectedSize: 40 },
];

// ---------------------------------------------------------------------------
// 教室（84 间：4 校区 × 21 间；room-<campus>-<建筑><房间号>）
// 建筑：X1-10x 综合教学楼 / X1-20x 公共教学楼 / X2-30x 基础实验楼 / X3-40x 工程实践楼 /
//       X4-50x 创新中心 / X5-60x 体育场馆。features 见 5.5 契约。
// 关键钉死教室：room-a-101（g03 冲突）、room-a-104/106（g01 冲突）、room-c-201（大班+赶场）、
//              room-c-302/303/304（g02/g04 冲突实验室）、room-b-201/202、room-d-201（大班）。
// ---------------------------------------------------------------------------
const mkRoom = (id, name, building, capacity, type, features) => {
  const parts = id.split("-"); // ["room", "a", "101"]
  return { id, name, campusId: `campus-${parts[1]}`, building, capacity, type, features };
};
const ROOMS = [
  // ---- 校区A ----
  mkRoom("room-a-101", "A1-101", "A综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-a-102", "A1-102", "A综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-a-103", "A1-103", "A综合教学楼", 80, "多媒体", ["projector", "smart_board", "recording"]),
  mkRoom("room-a-104", "A1-104", "A综合教学楼", 60, "机房", ["projector", "computer_lab", "smart_board"]),
  mkRoom("room-a-105", "A1-105", "A综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-a-106", "A1-106", "A综合教学楼", 80, "机房", ["projector", "computer_lab", "smart_board"]),
  mkRoom("room-a-201", "A1-201", "A公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-a-202", "A1-202", "A公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-a-203", "A1-203", "A公共教学楼", 100, "阶梯", ["projector", "smart_board"]),
  mkRoom("room-a-301", "A2-301", "A基础实验楼", 60, "机房", ["computer_lab", "projector"]),
  mkRoom("room-a-302", "A2-302", "A基础实验楼", 60, "机房", ["computer_lab", "projector"]),
  mkRoom("room-a-303", "A2-303", "A基础实验楼", 50, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-a-304", "A2-304", "A基础实验楼", 50, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-a-401", "A3-401", "A工程实践楼", 48, "机房", ["computer_lab", "projector"]),
  mkRoom("room-a-402", "A3-402", "A工程实践楼", 48, "机房", ["computer_lab", "projector"]),
  mkRoom("room-a-403", "A3-403", "A工程实践楼", 48, "实验室", ["wet_lab"]),
  mkRoom("room-a-501", "A4-501", "A创新中心", 48, "研讨室", ["seminar", "movable_seats"]),
  mkRoom("room-a-502", "A4-502", "A创新中心", 48, "工作室", ["studio", "recording"]),
  mkRoom("room-a-503", "A4-503", "A创新中心", 48, "研讨室", ["seminar", "projector"]),
  mkRoom("room-a-601", "A5-601", "A体育场馆", 200, "体育场地", ["movable_seats"]),
  mkRoom("room-a-602", "A5-602", "A体育场馆", 200, "体育场地", ["movable_seats"]),
  // ---- 校区B ----
  mkRoom("room-b-101", "B1-101", "B综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-b-102", "B1-102", "B综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-b-103", "B1-103", "B综合教学楼", 80, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-b-104", "B1-104", "B综合教学楼", 70, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-b-105", "B1-105", "B综合教学楼", 70, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-b-106", "B1-106", "B综合教学楼", 80, "多媒体", ["projector", "smart_board", "recording"]),
  mkRoom("room-b-107", "B1-107", "B语言实验室", 60, "语言实验室", ["language_lab", "projector"]),
  mkRoom("room-b-201", "B1-201", "B公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-b-202", "B1-202", "B公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-b-203", "B1-203", "B公共教学楼", 100, "阶梯", ["projector", "smart_board"]),
  mkRoom("room-b-301", "B2-301", "B基础实验楼", 60, "机房", ["computer_lab", "projector"]),
  mkRoom("room-b-302", "B2-302", "B基础实验楼", 60, "机房", ["computer_lab", "projector"]),
  mkRoom("room-b-303", "B2-303", "B基础实验楼", 50, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-b-304", "B2-304", "B基础实验楼", 50, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-b-401", "B3-401", "B工程实践楼", 48, "机房", ["computer_lab", "studio", "projector"]),
  mkRoom("room-b-402", "B3-402", "B工程实践楼", 48, "机房", ["computer_lab", "projector"]),
  mkRoom("room-b-403", "B3-403", "B工程实践楼", 48, "工作室", ["studio", "recording"]),
  mkRoom("room-b-501", "B4-501", "B创新中心", 48, "工作室", ["studio", "projector"]),
  mkRoom("room-b-502", "B4-502", "B创新中心", 48, "工作室", ["recording", "studio", "projector"]),
  mkRoom("room-b-503", "B4-503", "B创新中心", 48, "研讨室", ["seminar", "studio", "recording"]),
  mkRoom("room-b-601", "B5-601", "B体育场馆", 200, "体育场地", ["movable_seats"]),
  mkRoom("room-b-602", "B5-602", "B体育场馆", 200, "体育场地", ["movable_seats"]),
  // ---- 校区C ----
  mkRoom("room-c-101", "C1-101", "C综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-c-102", "C1-102", "C综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-c-103", "C1-103", "C综合教学楼", 80, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-c-104", "C1-104", "C综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-c-105", "C1-105", "C综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-c-106", "C1-106", "C综合教学楼", 80, "多媒体", ["projector", "smart_board", "recording"]),
  mkRoom("room-c-201", "C1-201", "C公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-c-202", "C1-202", "C公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-c-203", "C1-203", "C公共教学楼", 100, "阶梯", ["projector", "smart_board"]),
  mkRoom("room-c-301", "C2-301", "C基础实验楼", 100, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-c-302", "C2-302", "C基础实验楼", 100, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-c-303", "C2-303", "C基础实验楼", 100, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-c-304", "C2-304", "C基础实验楼", 100, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-c-401", "C3-401", "C工程实践楼", 48, "机房", ["computer_lab", "projector"]),
  mkRoom("room-c-402", "C3-402", "C工程实践楼", 48, "机房", ["computer_lab", "projector"]),
  mkRoom("room-c-403", "C3-403", "C工程实践楼", 48, "实验室", ["wet_lab"]),
  mkRoom("room-c-501", "C4-501", "C创新中心", 48, "研讨室", ["seminar", "movable_seats"]),
  mkRoom("room-c-502", "C4-502", "C创新中心", 48, "工作室", ["studio", "recording"]),
  mkRoom("room-c-503", "C4-503", "C创新中心", 48, "研讨室", ["seminar", "projector"]),
  mkRoom("room-c-601", "C5-601", "C体育场馆", 200, "体育场地", ["movable_seats"]),
  mkRoom("room-c-602", "C5-602", "C体育场馆", 200, "体育场地", ["movable_seats"]),
  // ---- 校区D ----
  mkRoom("room-d-101", "D1-101", "D综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-d-102", "D1-102", "D综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-d-103", "D1-103", "D综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-d-104", "D1-104", "D综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-d-105", "D1-105", "D综合教学楼", 60, "多媒体", ["projector", "smart_board"]),
  mkRoom("room-d-106", "D1-106", "D综合教学楼", 80, "多媒体", ["projector", "smart_board", "recording"]),
  mkRoom("room-d-201", "D1-201", "D公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-d-202", "D1-202", "D公共教学楼", 120, "阶梯", ["projector", "smart_board", "recording"]),
  mkRoom("room-d-203", "D1-203", "D公共教学楼", 100, "阶梯", ["projector", "smart_board"]),
  mkRoom("room-d-301", "D2-301", "D基础实验楼", 60, "机房", ["computer_lab", "projector"]),
  mkRoom("room-d-302", "D2-302", "D基础实验楼", 60, "机房", ["computer_lab", "projector"]),
  mkRoom("room-d-303", "D2-303", "D基础实验楼", 50, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-d-304", "D2-304", "D基础实验楼", 50, "实验室", ["wet_lab", "projector"]),
  mkRoom("room-d-401", "D3-401", "D工程实践楼", 48, "机房", ["computer_lab", "projector"]),
  mkRoom("room-d-402", "D3-402", "D工程实践楼", 48, "机房", ["computer_lab", "projector"]),
  mkRoom("room-d-403", "D3-403", "D工程实践楼", 48, "工作室", ["studio", "recording"]),
  mkRoom("room-d-501", "D4-501", "D创新中心", 48, "研讨室", ["seminar", "movable_seats"]),
  mkRoom("room-d-502", "D4-502", "D创新中心", 48, "研讨室", ["seminar", "projector"]),
  mkRoom("room-d-503", "D4-503", "D创新中心", 48, "工作室", ["studio", "recording"]),
  mkRoom("room-d-601", "D5-601", "D体育场馆", 200, "体育场地", ["movable_seats"]),
  mkRoom("room-d-602", "D5-602", "D体育场馆", 200, "体育场地", ["movable_seats"]),
];

// ---------------------------------------------------------------------------
// 演示用户（3 个：2 学生 + 1 教师）
// ---------------------------------------------------------------------------
const DEMO_USERS = [
  { id: "user-demo-001", name: "演示用户001", role: "student", classIds: ["class-cs-01"], campusId: "campus-a", collegeId: "college-cs" },
  { id: "user-demo-002", name: "演示用户002", role: "student", classIds: ["class-life-01"], campusId: "campus-c", collegeId: "college-life" },
  { id: "user-demo-003", name: "演示用户003", role: "teacher", teacherId: "teacher-039", campusId: "campus-a", collegeId: "college-edu" },
];

// ---------------------------------------------------------------------------
// 课表规则表：每条 = 课程 + 教师 + 班级 + 星期 + 起止节 + 周次（+可选钉死教室 room）
// weeks 语法（与 R50.0 §5.4 一致）：
//   "1-20" 区间 / "2,4,6" 枚举 / "1-16(单)" 单周 / "2-16(双)" 双周 / "1-4,7-10" 跨周不规则
// 未指定 room 的条目由生成器自动分配（容量≥班级规模 + features 覆盖 requiredFeatures + slot 空闲）。
// 关键设计：g01~g20 场景钉死 room；体育教师（T033/034/035/039）每个 slot 全不同；
//           英语教师 T025 14 门 14 个不同 slot；赶场（T003/T030）前后 slot 跨校区。
// ---------------------------------------------------------------------------
const LESSON_TABLE = [
  // ================= 校区A =================
  // ---- class-cs-01（120 人，大班）----
  { course: "course-002", teacher: "teacher-003", cls: "class-cs-01", room: "room-a-201", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 数据结构（g04 赶场起点）
  { course: "course-017", teacher: "teacher-001", cls: "class-cs-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 高等数学A
  { course: "course-001", teacher: "teacher-004", cls: "class-cs-01", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 程序设计
  { course: "course-066", teacher: "teacher-025", cls: "class-cs-01", weekday: 3, ps: 1, pe: 2, weeks: "1-16" }, // 大学英语
  { course: "course-067", teacher: "teacher-039", cls: "class-cs-01", room: "room-a-601", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-019", teacher: "teacher-005", cls: "class-cs-01", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 线性代数
  { course: "course-021", teacher: "teacher-011", cls: "class-cs-01", weekday: 5, ps: 1, pe: 2, weeks: "1-16" }, // 大学物理
  // ---- class-cs-02 ----
  { course: "course-010", teacher: "teacher-012", cls: "class-cs-02", room: "room-a-104", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 计算思维（g01）
  { course: "course-018", teacher: "teacher-002", cls: "class-cs-02", weekday: 1, ps: 1, pe: 2, weeks: "1-16" }, // 高等数学B
  { course: "course-001", teacher: "teacher-004", cls: "class-cs-02", weekday: 3, ps: 1, pe: 2, weeks: "1-16" }, // 程序设计
  { course: "course-066", teacher: "teacher-025", cls: "class-cs-02", weekday: 4, ps: 3, pe: 4, weeks: "1-16" }, // 大学英语
  { course: "course-067", teacher: "teacher-039", cls: "class-cs-02", room: "room-a-602", weekday: 5, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-003", teacher: "teacher-007", cls: "class-cs-02", weekday: 4, ps: 1, pe: 2, weeks: "1-16" }, // 数据库原理
  { course: "course-004", teacher: "teacher-008", cls: "class-cs-02", weekday: 5, ps: 3, pe: 4, weeks: "1-16" }, // 操作系统
  { course: "course-016", teacher: "teacher-004", cls: "class-cs-02", room: "room-a-302", weekday: 2, ps: 3, pe: 4, weeks: "1-16(双)" }, // 程序设计实验
  { course: "course-020", teacher: "teacher-013", cls: "class-cs-02", weekday: 4, ps: 7, pe: 8, weeks: "1-16" }, // 概率统计（g12 占周四7-8）
  // ---- class-sw-01 ----
  { course: "course-066", teacher: "teacher-025", cls: "class-sw-01", weekday: 5, ps: 3, pe: 4, weeks: "1-16" }, // 大学英语
  { course: "course-006", teacher: "teacher-009", cls: "class-sw-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 软件工程导论
  { course: "course-002", teacher: "teacher-003", cls: "class-sw-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 数据结构
  { course: "course-067", teacher: "teacher-039", cls: "class-sw-01", room: "room-a-601", weekday: 1, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-005", teacher: "teacher-006", cls: "class-sw-01", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 计算机网络
  { course: "course-018", teacher: "teacher-002", cls: "class-sw-01", weekday: 5, ps: 1, pe: 2, weeks: "1-16" }, // 高等数学B
  { course: "course-007", teacher: "teacher-010", cls: "class-sw-01", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 工程制图
  { course: "course-015", teacher: "teacher-003", cls: "class-sw-01", room: "room-a-402", weekday: 4, ps: 5, pe: 6, weeks: "1-16(单)" }, // 数据结构实验
  // ---- class-me-01 ----
  { course: "course-007", teacher: "teacher-010", cls: "class-me-01", weekday: 1, ps: 1, pe: 2, weeks: "1-16" }, // 工程制图
  { course: "course-008", teacher: "teacher-010", cls: "class-me-01", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 机械基础
  { course: "course-018", teacher: "teacher-002", cls: "class-me-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 高等数学B
  { course: "course-067", teacher: "teacher-039", cls: "class-me-01", room: "room-a-601", weekday: 3, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-009", teacher: "teacher-010", cls: "class-me-01", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 自动控制原理
  { course: "course-021", teacher: "teacher-011", cls: "class-me-01", weekday: 5, ps: 5, pe: 6, weeks: "1-16" }, // 大学物理
  { course: "course-001", teacher: "teacher-004", cls: "class-me-01", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 程序设计
  { course: "course-013", teacher: "teacher-010", cls: "class-me-01", room: "room-a-401", weekday: 5, ps: 7, pe: 8, weeks: "1-8" }, // 工程实践
  // ---- class-math-01 ----
  { course: "course-011", teacher: "teacher-012", cls: "class-math-01", room: "room-a-106", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 信息素养（g01）
  { course: "course-017", teacher: "teacher-001", cls: "class-math-01", weekday: 3, ps: 1, pe: 2, weeks: "1-16" }, // 高等数学A
  { course: "course-020", teacher: "teacher-013", cls: "class-math-01", weekday: 4, ps: 1, pe: 2, weeks: "1-16" }, // 概率统计
  { course: "course-021", teacher: "teacher-011", cls: "class-math-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 大学物理
  { course: "course-026", teacher: "teacher-013", cls: "class-math-01", weekday: 5, ps: 3, pe: 4, weeks: "9-16" }, // 数学建模
  { course: "course-067", teacher: "teacher-039", cls: "class-math-01", room: "room-a-601", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-019", teacher: "teacher-005", cls: "class-math-01", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 线性代数
  { course: "course-010", teacher: "teacher-012", cls: "class-math-01", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 计算思维（g12 占周四5-6）
  // ---- class-phy-01 ----
  { course: "course-012", teacher: "teacher-007", cls: "class-phy-01", room: "room-a-101", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 电路基础（g03）
  { course: "course-021", teacher: "teacher-011", cls: "class-phy-01", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 大学物理
  { course: "course-017", teacher: "teacher-001", cls: "class-phy-01", weekday: 5, ps: 3, pe: 4, weeks: "1-16" }, // 高等数学A
  { course: "course-067", teacher: "teacher-039", cls: "class-phy-01", room: "room-a-602", weekday: 2, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-020", teacher: "teacher-013", cls: "class-phy-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 概率统计
  { course: "course-028", teacher: "teacher-018", cls: "class-phy-01", weekday: 5, ps: 1, pe: 2, weeks: "1-8" }, // 学术写作
  { course: "course-022", teacher: "teacher-011", cls: "class-phy-01", room: "room-a-303", weekday: 4, ps: 7, pe: 8, weeks: "1-8(双)" }, // 物理实验
  // ---- class-chem-01 ----
  { course: "course-023", teacher: "teacher-014", cls: "class-chem-01", weekday: 1, ps: 1, pe: 2, weeks: "1-16" }, // 化学原理
  { course: "course-024", teacher: "teacher-014", cls: "class-chem-01", room: "room-a-304", weekday: 3, ps: 3, pe: 6, weeks: "1-16(单)" }, // 无机化学实验（g06 连续4节）
  { course: "course-067", teacher: "teacher-039", cls: "class-chem-01", room: "room-a-602", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-018", teacher: "teacher-002", cls: "class-chem-01", weekday: 4, ps: 1, pe: 2, weeks: "1-16" }, // 高等数学B
  { course: "course-025", teacher: "teacher-014", cls: "class-chem-01", weekday: 5, ps: 5, pe: 6, weeks: "1-16" }, // 有机化学
  { course: "course-047", teacher: "teacher-018", cls: "class-chem-01", weekday: 2, ps: 3, pe: 4, weeks: "1-8" }, // 学术阅读
  { course: "course-042", teacher: "teacher-014", cls: "class-chem-01", weekday: 5, ps: 7, pe: 8, weeks: "9-16" }, // 毕业设计指导
  // ---- class-stat-01 ----
  { course: "course-027", teacher: "teacher-023", cls: "class-stat-01", room: "room-a-101", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 统计学（g03）
  { course: "course-017", teacher: "teacher-001", cls: "class-stat-01", weekday: 1, ps: 3, pe: 4, weeks: "1-16" }, // 高等数学A
  { course: "course-020", teacher: "teacher-013", cls: "class-stat-01", weekday: 3, ps: 1, pe: 2, weeks: "1-16" }, // 概率统计
  { course: "course-067", teacher: "teacher-039", cls: "class-stat-01", room: "room-a-601", weekday: 5, ps: 3, pe: 4, weeks: "1-16" }, // 大学体育
  { course: "course-047", teacher: "teacher-018", cls: "class-stat-01", weekday: 2, ps: 5, pe: 6, weeks: "1-8" }, // 学术阅读
  { course: "course-064", teacher: "teacher-023", cls: "class-stat-01", room: "room-a-301", weekday: 2, ps: 7, pe: 8, weeks: "1-8(单)" }, // 数据分析实务

  // ================= 校区B =================
  // ---- class-chi-01 ----
  { course: "course-066", teacher: "teacher-025", cls: "class-chi-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 大学英语
  { course: "course-043", teacher: "teacher-015", cls: "class-chi-01", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 现代汉语
  { course: "course-044", teacher: "teacher-016", cls: "class-chi-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 中国文学
  { course: "course-067", teacher: "teacher-034", cls: "class-chi-01", room: "room-b-601", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-047", teacher: "teacher-018", cls: "class-chi-01", weekday: 5, ps: 3, pe: 4, weeks: "1-8" }, // 学术阅读
  { course: "course-050", teacher: "teacher-016", cls: "class-chi-01", weekday: 5, ps: 5, pe: 6, weeks: "9-16" }, // 文化创意产业
  // ---- class-jour-01 ----
  { course: "course-066", teacher: "teacher-025", cls: "class-jour-01", weekday: 5, ps: 5, pe: 6, weeks: "1-16" }, // 大学英语
  { course: "course-045", teacher: "teacher-017", cls: "class-jour-01", weekday: 1, ps: 3, pe: 4, weeks: "1-16" }, // 传播基础
  { course: "course-067", teacher: "teacher-034", cls: "class-jour-01", room: "room-b-601", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-043", teacher: "teacher-015", cls: "class-jour-01", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 现代汉语
  { course: "course-046", teacher: "teacher-017", cls: "class-jour-01", room: "room-b-502", weekday: 4, ps: 1, pe: 2, weeks: "1-16" }, // 新闻采访与写作
  { course: "course-052", teacher: "teacher-017", cls: "class-jour-01", room: "room-b-503", weekday: 4, ps: 3, pe: 4, weeks: "1-8(双)" }, // 播音与主持
  { course: "course-051", teacher: "teacher-017", cls: "class-jour-01", room: "room-b-502", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 摄影与摄像
  // ---- class-design-01 ----
  { course: "course-001", teacher: "teacher-003", cls: "class-design-01", room: "room-b-201", weekday: 1, ps: 7, pe: 8, weeks: "1-16" }, // 程序设计（g04 赶场终点）
  { course: "course-067", teacher: "teacher-034", cls: "class-design-01", room: "room-b-602", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-048", teacher: "teacher-016", cls: "class-design-01", room: "room-b-501", weekday: 4, ps: 3, pe: 4, weeks: "1-16" }, // 视觉传达设计
  { course: "course-045", teacher: "teacher-017", cls: "class-design-01", weekday: 5, ps: 3, pe: 4, weeks: "1-16" }, // 传播基础
  { course: "course-014", teacher: "teacher-040", cls: "class-design-01", room: "room-b-503", weekday: 3, ps: 1, pe: 2, weeks: "9-16" }, // 创新训练
  { course: "course-028", teacher: "teacher-018", cls: "class-design-01", weekday: 2, ps: 1, pe: 2, weeks: "1-8" }, // 学术写作
  { course: "course-053", teacher: "teacher-016", cls: "class-design-01", room: "room-b-401", weekday: 5, ps: 7, pe: 8, weeks: "1-8(单)" }, // 设计软件应用
  // ---- class-hist-01 ----
  { course: "course-066", teacher: "teacher-025", cls: "class-hist-01", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 大学英语
  { course: "course-067", teacher: "teacher-034", cls: "class-hist-01", room: "room-b-602", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-044", teacher: "teacher-016", cls: "class-hist-01", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 中国文学
  { course: "course-043", teacher: "teacher-015", cls: "class-hist-01", weekday: 5, ps: 3, pe: 4, weeks: "1-16" }, // 现代汉语
  { course: "course-047", teacher: "teacher-018", cls: "class-hist-01", weekday: 3, ps: 3, pe: 4, weeks: "1-8" }, // 学术阅读
  { course: "course-049", teacher: "teacher-016", cls: "class-hist-01", weekday: 1, ps: 1, pe: 2, weeks: "9-16" }, // 中国历史通论
  { course: "course-054", teacher: "teacher-016", cls: "class-hist-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 媒体伦理
  // ---- class-biz-01（90 人大班）----
  { course: "course-066", teacher: "teacher-025", cls: "class-biz-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 大学英语
  { course: "course-055", teacher: "teacher-020", cls: "class-biz-01", room: "room-b-201", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 管理学
  { course: "course-057", teacher: "teacher-022", cls: "class-biz-01", room: "room-b-202", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 市场分析
  { course: "course-067", teacher: "teacher-034", cls: "class-biz-01", room: "room-b-601", weekday: 5, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-056", teacher: "teacher-021", cls: "class-biz-01", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 经济学基础
  { course: "course-058", teacher: "teacher-024", cls: "class-biz-01", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 会计学
  { course: "course-059", teacher: "teacher-030", cls: "class-biz-01", weekday: 5, ps: 9, pe: 10, weeks: "1-8" }, // 电子商务（g15 晚间课）
  // ---- class-econ-01 ----
  { course: "course-057", teacher: "teacher-022", cls: "class-econ-01", room: "room-b-104", weekday: 5, ps: 5, pe: 6, weeks: "1-16" }, // 市场分析
  { course: "course-056", teacher: "teacher-021", cls: "class-econ-01", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 经济学基础
  { course: "course-067", teacher: "teacher-034", cls: "class-econ-01", room: "room-b-601", weekday: 5, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-055", teacher: "teacher-020", cls: "class-econ-01", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 管理学
  { course: "course-058", teacher: "teacher-024", cls: "class-econ-01", weekday: 4, ps: 1, pe: 2, weeks: "1-16" }, // 会计学
  { course: "course-018", teacher: "teacher-002", cls: "class-econ-01", weekday: 1, ps: 3, pe: 4, weeks: "1-16" }, // 高等数学B
  { course: "course-061", teacher: "teacher-021", cls: "class-econ-01", weekday: 1, ps: 1, pe: 2, weeks: "9-16" }, // 金融学基础
  { course: "course-062", teacher: "teacher-024", cls: "class-econ-01", room: "room-b-107", weekday: 4, ps: 3, pe: 4, weeks: "1-16" }, // 商务英语
  // ---- class-acct-01 ----
  { course: "course-066", teacher: "teacher-025", cls: "class-acct-01", weekday: 1, ps: 3, pe: 4, weeks: "1-16" }, // 大学英语
  { course: "course-058", teacher: "teacher-024", cls: "class-acct-01", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 会计学
  { course: "course-067", teacher: "teacher-034", cls: "class-acct-01", room: "room-b-602", weekday: 1, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-056", teacher: "teacher-021", cls: "class-acct-01", weekday: 5, ps: 3, pe: 4, weeks: "1-16" }, // 经济学基础
  { course: "course-055", teacher: "teacher-020", cls: "class-acct-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 管理学
  { course: "course-027", teacher: "teacher-023", cls: "class-acct-01", weekday: 4, ps: 3, pe: 4, weeks: "1-16" }, // 统计学
  { course: "course-061", teacher: "teacher-021", cls: "class-acct-01", weekday: 2, ps: 1, pe: 2, weeks: "9-16" }, // 金融学基础
  // ---- class-pub-01 ----
  { course: "course-067", teacher: "teacher-034", cls: "class-pub-01", room: "room-b-602", weekday: 3, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-055", teacher: "teacher-020", cls: "class-pub-01", weekday: 1, ps: 1, pe: 2, weeks: "1-16" }, // 管理学
  { course: "course-056", teacher: "teacher-021", cls: "class-pub-01", weekday: 3, ps: 1, pe: 2, weeks: "1-16" }, // 经济学基础
  { course: "course-027", teacher: "teacher-023", cls: "class-pub-01", weekday: 5, ps: 1, pe: 2, weeks: "1-16" }, // 统计学
  { course: "course-060", teacher: "teacher-020", cls: "class-pub-01", weekday: 4, ps: 3, pe: 4, weeks: "1-16" }, // 公共管理
  { course: "course-063", teacher: "teacher-022", cls: "class-pub-01", weekday: 4, ps: 1, pe: 2, weeks: "9-16" }, // 市场营销
  { course: "course-065", teacher: "teacher-020", cls: "class-pub-01", weekday: 5, ps: 7, pe: 8, weeks: "9-16" }, // 经济学原理

  // ================= 校区C =================
  // ---- class-life-01（100 人）----
  { course: "course-029", teacher: "teacher-026", cls: "class-life-01", room: "room-c-201", weekday: 5, ps: 5, pe: 6, weeks: "1-16" }, // 普通生物学（g02 班级冲突）
  { course: "course-035", teacher: "teacher-027", cls: "class-life-01", room: "room-c-302", weekday: 5, ps: 5, pe: 6, weeks: "1-16(单)" }, // 生物实验（g02）
  { course: "course-057", teacher: "teacher-030", cls: "class-life-01", room: "room-c-201", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 市场分析（g05 赶场起点）
  { course: "course-067", teacher: "teacher-033", cls: "class-life-01", room: "room-c-601", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-030", teacher: "teacher-027", cls: "class-life-01", weekday: 3, ps: 1, pe: 2, weeks: "1-16" }, // 生物化学
  { course: "course-033", teacher: "teacher-029", cls: "class-life-01", weekday: 1, ps: 1, pe: 2, weeks: "1-16" }, // 生态学基础
  { course: "course-028", teacher: "teacher-018", cls: "class-life-01", weekday: 4, ps: 3, pe: 4, weeks: "1-8" }, // 学术写作
  { course: "course-034", teacher: "teacher-031", cls: "class-life-01", room: "room-c-301", weekday: 2, ps: 3, pe: 4, weeks: "1-8(双)" }, // 实验技能
  // ---- class-life-02 ----
  { course: "course-066", teacher: "teacher-025", cls: "class-life-02", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 大学英语
  { course: "course-035", teacher: "teacher-019", cls: "class-life-02", room: "room-c-304", weekday: 5, ps: 5, pe: 6, weeks: "1-16(单)" }, // 生物实验（g04 教师冲突）
  { course: "course-031", teacher: "teacher-028", cls: "class-life-02", weekday: 3, ps: 3, pe: 4, weeks: "1-16" }, // 遗传学基础
  { course: "course-029", teacher: "teacher-026", cls: "class-life-02", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 普通生物学
  { course: "course-067", teacher: "teacher-033", cls: "class-life-02", room: "room-c-602", weekday: 5, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-034", teacher: "teacher-031", cls: "class-life-02", room: "room-c-301", weekday: 4, ps: 1, pe: 2, weeks: "1-16" }, // 实验技能
  { course: "course-039", teacher: "teacher-027", cls: "class-life-02", room: "room-c-303", weekday: 2, ps: 5, pe: 6, weeks: "9-16" }, // 微生物学
  // ---- class-bio-01 ----
  { course: "course-033", teacher: "teacher-029", cls: "class-bio-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 生态学基础
  { course: "course-032", teacher: "teacher-031", cls: "class-bio-01", weekday: 4, ps: 3, pe: 4, weeks: "1-16" }, // 动物生理学
  { course: "course-031", teacher: "teacher-028", cls: "class-bio-01", weekday: 5, ps: 1, pe: 2, weeks: "1-16" }, // 遗传学基础
  { course: "course-067", teacher: "teacher-033", cls: "class-bio-01", room: "room-c-601", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-030", teacher: "teacher-027", cls: "class-bio-01", weekday: 1, ps: 3, pe: 4, weeks: "1-16" }, // 生物化学
  { course: "course-029", teacher: "teacher-026", cls: "class-bio-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 普通生物学
  { course: "course-040", teacher: "teacher-031", cls: "class-bio-01", room: "room-c-401", weekday: 6, ps: 1, pe: 2, weeks: "1-16" }, // 生物信息学（g16 周末课）
  { course: "course-041", teacher: "teacher-029", cls: "class-bio-01", weekday: 3, ps: 1, pe: 2, weeks: "9-16" }, // 生态学野外实践
  // ---- class-env-01 ----
  { course: "course-066", teacher: "teacher-025", cls: "class-env-01", weekday: 1, ps: 1, pe: 2, weeks: "1-16" }, // 大学英语
  { course: "course-036", teacher: "teacher-019", cls: "class-env-01", room: "room-c-303", weekday: 5, ps: 5, pe: 6, weeks: "1-16(单)" }, // 化学实验（g04 教师冲突）
  { course: "course-033", teacher: "teacher-029", cls: "class-env-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 生态学基础
  { course: "course-067", teacher: "teacher-033", cls: "class-env-01", room: "room-c-601", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-037", teacher: "teacher-031", cls: "class-env-01", room: "room-c-301", weekday: 5, ps: 3, pe: 4, weeks: "1-8(单)" }, // 环境工程实验
  { course: "course-028", teacher: "teacher-018", cls: "class-env-01", weekday: 1, ps: 3, pe: 4, weeks: "1-8" }, // 学术写作
  { course: "course-038", teacher: "teacher-031", cls: "class-env-01", weekday: 4, ps: 7, pe: 8, weeks: "9-16" }, // 环境监测

  // ================= 校区D =================
  // ---- class-edu-01（72 人）----
  { course: "course-066", teacher: "teacher-025", cls: "class-edu-01", weekday: 4, ps: 1, pe: 2, weeks: "1-16" }, // 大学英语
  { course: "course-068", teacher: "teacher-032", cls: "class-edu-01", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 教育学
  { course: "course-059", teacher: "teacher-030", cls: "class-edu-01", room: "room-d-201", weekday: 3, ps: 7, pe: 8, weeks: "1-16" }, // 电子商务（g05 赶场终点）
  { course: "course-067", teacher: "teacher-035", cls: "class-edu-01", room: "room-d-601", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-070", teacher: "teacher-037", cls: "class-edu-01", weekday: 2, ps: 1, pe: 2, weeks: "1-16" }, // 课程设计
  { course: "course-069", teacher: "teacher-036", cls: "class-edu-01", weekday: 5, ps: 1, pe: 2, weeks: "1-16" }, // 心理学基础
  { course: "course-071", teacher: "teacher-038", cls: "class-edu-01", weekday: 1, ps: 3, pe: 4, weeks: "1-8" }, // 教学实习（g08 低负载）
  { course: "course-042", teacher: "teacher-032", cls: "class-edu-01", weekday: 3, ps: 5, pe: 6, weeks: "9-16" }, // 毕业设计指导
  // ---- class-pe-01（40 人）----
  { course: "course-066", teacher: "teacher-025", cls: "class-pe-01", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 大学英语
  { course: "course-067", teacher: "teacher-035", cls: "class-pe-01", room: "room-d-601", weekday: 1, ps: 3, pe: 4, weeks: "1-16" }, // 专项训练
  { course: "course-067", teacher: "teacher-035", cls: "class-pe-01", room: "room-d-602", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 体能训练
  { course: "course-068", teacher: "teacher-032", cls: "class-pe-01", weekday: 4, ps: 3, pe: 4, weeks: "1-16" }, // 教育学
  { course: "course-073", teacher: "teacher-036", cls: "class-pe-01", weekday: 2, ps: 3, pe: 4, weeks: "1-16" }, // 运动生理学
  { course: "course-028", teacher: "teacher-018", cls: "class-pe-01", weekday: 3, ps: 1, pe: 2, weeks: "1-8" }, // 学术写作
  { course: "course-070", teacher: "teacher-037", cls: "class-pe-01", weekday: 5, ps: 7, pe: 8, weeks: "9-16" }, // 课程设计
  // ---- class-psych-01（42 人）----
  { course: "course-066", teacher: "teacher-025", cls: "class-psych-01", weekday: 5, ps: 1, pe: 2, weeks: "1-16" }, // 大学英语
  { course: "course-069", teacher: "teacher-036", cls: "class-psych-01", weekday: 3, ps: 5, pe: 6, weeks: "1-16" }, // 心理学基础
  { course: "course-068", teacher: "teacher-032", cls: "class-psych-01", weekday: 2, ps: 5, pe: 6, weeks: "1-16" }, // 教育学
  { course: "course-067", teacher: "teacher-035", cls: "class-psych-01", room: "room-d-601", weekday: 1, ps: 5, pe: 6, weeks: "1-16" }, // 大学体育
  { course: "course-072", teacher: "teacher-040", cls: "class-psych-01", room: "room-d-501", weekday: 4, ps: 1, pe: 2, weeks: "1-4,7-10" }, // 研讨课（g18 跨周不规则）
  { course: "course-047", teacher: "teacher-018", cls: "class-psych-01", weekday: 4, ps: 5, pe: 6, weeks: "1-8" }, // 学术阅读
  { course: "course-042", teacher: "teacher-032", cls: "class-psych-01", weekday: 4, ps: 7, pe: 8, weeks: "9-16" }, // 毕业设计指导
  // ---- class-prim-01（38 人）----
  { course: "course-066", teacher: "teacher-025", cls: "class-prim-01", weekday: 4, ps: 5, pe: 6, weeks: "1-16" }, // 大学英语
  { course: "course-070", teacher: "teacher-037", cls: "class-prim-01", weekday: 3, ps: 1, pe: 2, weeks: "1-16" }, // 课程设计
  { course: "course-068", teacher: "teacher-032", cls: "class-prim-01", weekday: 1, ps: 1, pe: 2, weeks: "1-16" }, // 教育学
  { course: "course-067", teacher: "teacher-035", cls: "class-prim-01", room: "room-d-602", weekday: 2, ps: 7, pe: 8, weeks: "1-16" }, // 大学体育
  { course: "course-072", teacher: "teacher-040", cls: "class-prim-01", room: "room-d-501", weekday: 5, ps: 5, pe: 6, weeks: "1-8(双)" }, // 研讨课
  { course: "course-028", teacher: "teacher-018", cls: "class-prim-01", weekday: 3, ps: 5, pe: 6, weeks: "1-8" }, // 学术写作
  { course: "course-042", teacher: "teacher-032", cls: "class-prim-01", weekday: 5, ps: 3, pe: 4, weeks: "9-16" }, // 毕业设计指导
];

// ---------------------------------------------------------------------------
// 周次展开：支持 "1-16" 区间 / "2,4,6" 枚举 / "1-16(单)" 单周 / "2-16(双)" 双周 / "1-4,7-10" 跨周不规则 / 单数字
// ---------------------------------------------------------------------------
function expandWeeks(expr) {
  const out = [];
  for (const raw of String(expr).split(",")) {
    const part = raw.trim();
    const odd = part.endsWith("(单)");
    const even = part.endsWith("(双)");
    const core = part.replace(/\(单\)$|\(双\)$/, "");
    const range = core.split("-").map(Number);
    if (range.length === 1) {
      if ((odd && range[0] % 2 === 1) || (!odd && !even) || (even && range[0] % 2 === 0)) out.push(range[0]);
    } else {
      for (let w = range[0]; w <= range[1]; w++) {
        if (odd && w % 2 === 0) continue;
        if (even && w % 2 === 1) continue;
        out.push(w);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function periodsOverlap(a, b) {
  return a.ps <= b.pe && b.ps <= a.pe;
}

function weeksOverlap(wa, wb) {
  const set = new Set(wb);
  return wa.some((w) => set.has(w));
}

// ---------------------------------------------------------------------------
// 两遍法教室自动分配：
//   第一遍：显式钉死 room 的条目直接登记占用（含设计冲突，不抛错）；
//   第二遍：未指定 room 的条目按「容量≥班级规模 + features 覆盖课程 requiredFeatures + slot 空闲」，
//           在该班级 campus 的 ROOMS 中按 id 升序取第一个可用；找不到则抛错。
// ---------------------------------------------------------------------------
const ROOM_OCCUPANCY = {};
function roomFreeAt(roomId, weekday, ps, pe, weeks) {
  const list = ROOM_OCCUPANCY[roomId] || [];
  return !list.some(
    (o) => o.weekday === weekday && periodsOverlap(o, { ps, pe }) && weeksOverlap(o.weeks, weeks)
  );
}
function occupyRoom(roomId, weekday, ps, pe, weeks) {
  (ROOM_OCCUPANCY[roomId] = ROOM_OCCUPANCY[roomId] || []).push({ weekday, ps, pe, weeks });
}

const classesById = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));
const roomsById = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

function resolveRooms() {
  // 第一遍：钉死教室
  for (const t of LESSON_TABLE) {
    if (!t.room) continue;
    const weeks = expandWeeks(t.weeks);
    occupyRoom(t.room, t.weekday, t.ps, t.pe, weeks);
  }
  // 第二遍：自动分配
  const resolved = LESSON_TABLE.map((t) => ({ ...t }));
  for (const t of resolved) {
    if (t.room) continue;
    const cls = classesById[t.cls];
    const course = coursesById[t.course];
    const weeks = expandWeeks(t.weeks);
    const campusRooms = ROOMS.filter((r) => r.campusId === cls.campusId).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    const picked = campusRooms.find(
      (r) =>
        r.capacity >= cls.size &&
        course.requiredFeatures.every((f) => r.features.includes(f)) &&
        roomFreeAt(r.id, t.weekday, t.ps, t.pe, weeks)
    );
    if (!picked) {
      throw new Error(
        `[generator] 自动分配教室失败: ${t.course}(${course.name}) ${t.cls} @w${t.weekday} ${t.ps}-${t.pe} ${t.weeks}`
      );
    }
    t.room = picked.id;
    occupyRoom(picked.id, t.weekday, t.ps, t.pe, weeks);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// 硬冲突自检：统计 teacher/class/room 冲突，必须与 EXPECTED_CONFLICT_KEYS 完全一致
// ---------------------------------------------------------------------------
const EXPECTED_CONFLICT_KEYS = [
  "teacher:teacher-012", // g01 周二5-6 计算思维 + 信息素养
  "room:room-a-101", // g03 周四5-6 统计学 + 电路基础
  "class:class-life-01", // g02 周五5-6 普通生物学 + 生物实验
  "teacher:teacher-019", // g04 周五5-6 化学实验 + 生物实验
];

function findConflicts(lessons) {
  const keys = [];
  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const a = lessons[i];
      const b = lessons[j];
      if (a.weekday !== b.weekday) continue;
      if (!periodsOverlap({ ps: a.periodStart, pe: a.periodEnd }, { ps: b.periodStart, pe: b.periodEnd })) continue;
      if (!weeksOverlap(a.weekList, b.weekList)) continue;
      if (a.teacherIds[0] === b.teacherIds[0]) keys.push(`teacher:${a.teacherIds[0]}`);
      if (a.classIds[0] === b.classIds[0]) keys.push(`class:${a.classIds[0]}`);
      if (a.roomId === b.roomId) keys.push(`room:${a.roomId}`);
    }
  }
  return keys.sort();
}

function assertDesignedConflicts(lessons) {
  const actual = findConflicts(lessons);
  const expected = [...EXPECTED_CONFLICT_KEYS].sort();
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    const aSet = new Set(actual);
    const eSet = new Set(expected);
    const extra = [...aSet].filter((k) => !eSet.has(k));
    const missing = [...eSet].filter((k) => !aSet.has(k));
    throw new Error(
      `[generator] 硬冲突与设计白名单不一致\n  actual  = ${actualStr}\n  expected= ${expectedStr}\n  extra  = ${JSON.stringify(extra)}\n  missing= ${JSON.stringify(missing)}`
    );
  }
}

// ---------------------------------------------------------------------------
// 生成主流程
// ---------------------------------------------------------------------------
function buildLessons(resolved) {
  return resolved.map((t, i) => {
    const cls = classesById[t.cls];
    const weeks = expandWeeks(t.weeks);
    return {
      id: `lesson-${String(i + 1).padStart(3, "0")}`,
      courseId: t.course,
      teacherIds: [t.teacher],
      classIds: [t.cls],
      roomId: t.room,
      roomName: roomsById[t.room].name,
      campusId: cls.campusId,
      weekday: t.weekday,
      periodStart: t.ps,
      periodEnd: t.pe,
      weeks: t.weeks,
      weekList: weeks,
    };
  });
}

function buildDataset(resolvedLessons) {
  const dataset = {
    // 复用文件头 META（含 semester/periods/weekdayNames/designedScenarios 等完整契约字段）
    meta: { ...META, dataHash: null },
    campuses: CAMPUSES,
    campusTravelMatrix: CAMPUS_TRAVEL_MATRIX,
    colleges: COLLEGES,
    classes: CLASSES,
    teachers: TEACHERS,
    courses: COURSES,
    rooms: ROOMS,
    lessons: resolvedLessons,
    demoUsers: DEMO_USERS,
  };
  dataset.meta.dataHash = computeDataHash(dataset);
  return dataset;
}

function main() {
  const resolved = resolveRooms();
  const lessons = buildLessons(resolved);
  assertDesignedConflicts(lessons);
  const dataset = buildDataset(lessons);
  const outFile = path.join(__dirname, "competition-demo-v3.json");
  fs.writeFileSync(outFile, JSON.stringify(dataset, null, 2) + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `[competition-demo-v3] generated: ${dataset.lessons.length} lessons, ` +
      `dataHash=${dataset.meta.dataHash}, conflicts=${findConflicts(lessons).length}, ` +
      `file=${outFile}`
  );
}

if (require.main === module) {
  main();
}

module.exports = { expandWeeks, buildLessons, buildDataset, findConflicts, EXPECTED_CONFLICT_KEYS };
