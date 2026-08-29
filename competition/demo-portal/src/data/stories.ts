import { type CaseKey } from "./cases";

export interface StoryFlow {
  label: string;
  value?: string;
}

export interface StoryCard {
  key: CaseKey;
  title: string;
  problem: string;
  action: string;
  outcome: string;
  flow: StoryFlow[];
  tags: string[];
  accent: string;
}

export const STORY_CARDS: StoryCard[] = [
  {
    key: "query",
    title: "课表查询",
    problem: "教师025未来四周怎么上课？",
    action: "小序先查确定性课表，再算出四周负载，最后关联赶场风险。",
    outcome: "56 节落在四周，识别出 4 次跨校区赶场预警。",
    flow: [
      { label: "教师025" },
      { label: "未来四周", value: "56 节" },
      { label: "每周稳定", value: "14 节" },
      { label: "赶场预警", value: "4 次" },
    ],
    tags: ["Multi-Agent", "CampusTools", "Verified"],
    accent: "#d9593f",
  },
  {
    key: "collaboration",
    title: "多人协同",
    problem: "三位老师什么时候共同空闲？",
    action: "拆解教师005、006、014的课表，求共同窗口，再按容量筛教室。",
    outcome: "从 63 间候选中锁定 7 间，推荐 A1-201（120 座）。",
    flow: [
      { label: "3 位教师" },
      { label: "共同空闲" },
      { label: "63 间候选" },
      { label: "7 间满足 120 座" },
      { label: "推荐 A1-201" },
    ],
    tags: ["Multi-Agent", "CampusTools", "Verified"],
    accent: "#c98a62",
  },
  {
    key: "reschedule",
    title: "模拟调课",
    problem: "这门课挪到周四 7-8 节行不行？",
    action: "原样保留周一原排，只模拟新时间，自动选教室并逐项核验。",
    outcome: "可行，保留连堂负荷提示，未改动任何真实课表。",
    flow: [
      { label: "周一 5-6 节" },
      { label: "周四 7-8 节" },
      { label: "自动选教室", value: "A1-201" },
      { label: "约束核验", value: "通过" },
      { label: "保留风险" },
    ],
    tags: ["Multi-Agent", "CampusTools", "Verified"],
    accent: "#d87c5f",
  },
  {
    key: "insight",
    title: "校园洞察",
    problem: "未来四周谁最忙？",
    action: "统计四周教师负载，排出前十，再下钻最高负载教师的课表与风险。",
    outcome: "Top1 教师025 达 112 学时，无冲突但有 4 次赶场预警。",
    flow: [
      { label: "四周负载", value: "112 学时" },
      { label: "Top1", value: "教师025" },
      { label: "次位", value: "教师018" },
      { label: "风险", value: "赶场 4 次" },
    ],
    tags: ["Multi-Agent", "CampusTools", "Verified"],
    accent: "#b9674f",
  },
];
