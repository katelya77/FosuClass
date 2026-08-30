import {
  CalendarCheck,
  LayoutDashboard,
  School,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type HeroCaseKey = "query" | "collaboration" | "reschedule" | "insight";
export type CaseKey = "general" | HeroCaseKey;

export interface ExperienceContext {
  label: string;
  value: string;
}

export interface ExperienceCase<K extends CaseKey = CaseKey> {
  key: K;
  title: string;
  eyebrow: string;
  shortPrompt: string;
  fullPrompt: string;
  taskLabel: string;
  steps: string[];
  context: ExperienceContext[];
  icon: LucideIcon;
  accent: string;
}

export const GENERAL_EXPERIENCE: ExperienceCase = {
  key: "general",
  title: "全部能力",
  eyebrow: "总览 · 问问小序",
  shortPrompt: "不确定从哪开始？直接描述你的教学安排问题。",
  fullPrompt: "先查教师025第1周课表，再解释他的负载和风险。",
  taskLabel: "不预设场景，直接说出对象、时间和你想完成的事",
  steps: ["理解对象与时间", "转交对应专业智能体", "用 CampusTools 核验并返回结果卡"],
  context: [
    { label: "协作", value: "主协调 → 专业智能体 → 主协调" },
    { label: "能力", value: "4 Agent · 13 CampusTools" },
    { label: "结果", value: "已核验 · 核验依据 · 结果卡" },
  ],
  icon: Sparkles,
  accent: "#d9593f",
};

export const EXPERIENCE_CASES: ExperienceCase<HeroCaseKey>[] = [
  {
    key: "query",
    title: "查课表",
    eyebrow: "01 · 学生查询",
    shortPrompt: "查看2025级计算机类01班第1周课表。",
    fullPrompt: "查看2025级计算机类01班第1周课表。",
    taskLabel: "想知道一个班本周的完整课表",
    steps: ["一句话说明班级", "返回完整课表", "继续追问不丢上下文"],
    context: [
      { label: "对象", value: "2025级计算机类01班" },
      { label: "范围", value: "第1周全部课次" },
      { label: "接着问", value: "只看周三 · 这节课在哪" },
      { label: "能力", value: "班级 / 教师 / 课程 / 教室" },
    ],
    icon: CalendarCheck,
    accent: "#d9593f",
  },
  {
    key: "collaboration",
    title: "找共同时间",
    eyebrow: "02 · 多人协同",
    shortPrompt: "帮教师005、006、014找共同空闲教室",
    fullPrompt:
      "帮教师005、教师006、教师014寻找第1周周四上午的共同空闲，并推荐一间满足需求的教室。",
    taskLabel: "为三位教师找一段共同空闲与合适教室",
    steps: ["拆解三位教师课表", "计算共同空闲", "筛选满足容量的教室"],
    context: [
      { label: "对象", value: "教师005、006、014" },
      { label: "时段", value: "第1周 周四 1-4节" },
      { label: "时间", value: "2026-09-03 08:00–11:40" },
      { label: "需求", value: "容量 ≥ 120 座" },
    ],
    icon: UsersRound,
    accent: "#c98a62",
  },
  {
    key: "reschedule",
    title: "模拟调课",
    eyebrow: "03 · 调课模拟",
    shortPrompt: "把这门课调整到周四7-8节是否可行？",
    fullPrompt:
      "模拟把2025级计算机类01班第1周周一第5-6节的数据结构课调整到第1周周四第7-8节，不指定教室，请帮我自动选择合适教室，并检查可行性和风险。",
    taskLabel: "把一门课安全地挪到新时间",
    steps: ["确认原安排", "模拟新时间", "自动选教室并核验"],
    context: [
      { label: "课程", value: "数据结构" },
      { label: "班级", value: "2025级计算机类01班" },
      { label: "原安排", value: "第1周 周一 5-6节 · A1-201" },
      { label: "目标", value: "第1周 周四 7-8节 · 自动选教室" },
    ],
    icon: School,
    accent: "#d87c5f",
  },
  {
    key: "insight",
    title: "看全校态势",
    eyebrow: "04 · 校园洞察",
    shortPrompt: "未来四周教师负载最高的是谁？",
    fullPrompt: "未来四周教师负载最高的是谁？",
    taskLabel: "看清未来四周全校教师负载与风险",
    steps: ["统计四周负载", "定位最高负载教师", "关联转场与冲突"],
    context: [
      { label: "范围", value: "未来四周（第1-4周）" },
      { label: "负载第一", value: "教师025 · 56 节 / 112 学时" },
      { label: "次位", value: "教师018 · 44 节 / 88 学时" },
      { label: "风险", value: "冲突 0 · 转场预警 4 次" },
    ],
    icon: LayoutDashboard,
    accent: "#b9674f",
  },
];

export const EXPERIENCE_TABS: ExperienceCase[] = [GENERAL_EXPERIENCE, ...EXPERIENCE_CASES];

export function getCaseByKey(key?: string): ExperienceCase | undefined {
  return EXPERIENCE_TABS.find((item) => item.key === key);
}
