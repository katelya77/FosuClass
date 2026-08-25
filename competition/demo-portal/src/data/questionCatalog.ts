export interface CatalogQuestion {
  text: string;
  golden?: boolean;
}

export interface AgentQuestionGroup {
  agentId: "coordinator" | "course" | "risk" | "insight";
  name: string;
  role: string;
  widget: string;
  questions: CatalogQuestion[];
}

/**
 * Final-facing question library derived from the frozen R51 prompts, 13 CampusTools
 * and the seven result-card variants. Golden marks only the four verified Hero paths;
 * the remaining entries are supported deterministic-tool examples, not extra claims.
 */
export const AGENT_QUESTION_GROUPS: AgentQuestionGroup[] = [
  {
    agentId: "coordinator",
    name: "小序·主协调",
    role: "跨域理解与连续追问",
    widget: "统一结果卡",
    questions: [
      { text: "未来四周谁最忙？再检查 Top1 的跨校区赶场风险。", golden: true },
      { text: "先查教师025第1周课表，再解释他的负载和风险。" },
    ],
  },
  {
    agentId: "course",
    name: "课程空间",
    role: "课表、空间与多人协同",
    widget: "课表 / 空间 / 协同卡",
    questions: [
      { text: "查看教师025第1周课表。" },
      { text: "查看2025级计算机类01班第1周课表。" },
      { text: "数据结构第1周在哪些班级和教室上课？" },
      { text: "A1-201第1周什么时候有课？" },
      { text: "帮教师005、006、014找第1周周四上午共同空闲，并推荐120座教室。", golden: true },
    ],
  },
  {
    agentId: "risk",
    name: "风险规划",
    role: "冲突、赶场、日计划与调课",
    widget: "风险 / What-if 核验卡",
    questions: [
      { text: "检查教师025未来四周的教学风险。", golden: true },
      { text: "生成教师025第1周周一的教学日计划与提醒。" },
      { text: "把数据结构模拟调整到第1周周四7-8节，并核验可行性。", golden: true },
    ],
  },
  {
    agentId: "insight",
    name: "校园洞察",
    role: "态势、负载与空间利用",
    widget: "排名 / 态势洞察卡",
    questions: [
      { text: "未来四周教师负载最高的是谁？", golden: true },
      { text: "给我一份未来四周的教学运行概览。" },
      { text: "未来四周哪些教室利用率最高？" },
    ],
  },
];
