export interface AgentBrand {
  id: string;
  name: string;
  en: string;
  role: string;
  image: string;
  accent: string;
}

/**
 * 品牌图来源：competition/demo-portal/public/branding。
 * 图片均为 1:1 方形 App 图标风格，展示时统一 object-contain，避免拉伸变形。
 */
export const AGENT_BRANDS: AgentBrand[] = [
  {
    id: "coordinator",
    name: "主协调 Agent",
    en: "Coordinator",
    role: "统筹多 Agent 协作",
    image: "/branding/coordinator-agent.png",
    accent: "#d9593f",
  },
  {
    id: "risk",
    name: "风险规划 Agent",
    en: "Risk Planning",
    role: "识别赶场与冲突",
    image: "/branding/risk-agent.png",
    accent: "#b9674f",
  },
  {
    id: "insight",
    name: "校园洞察 Agent",
    en: "Campus Insight",
    role: "负载与全校态势",
    image: "/branding/campus-insight-agent.png",
    accent: "#c98a62",
  },
  {
    id: "course",
    name: "课程空间 Agent",
    en: "Course Space",
    role: "课表、教室与协同",
    image: "/branding/course-space-agent.png",
    accent: "#d87c5f",
  },
  {
    id: "plugin",
    name: "CampusTools",
    en: "Plugin",
    role: "确定性工具底座",
    image: "/branding/camptools-plugin.png",
    accent: "#8f2f22",
  },
];

export const CHAT_BACKGROUND = {
  image: "/branding/chat-background.png",
  alt: "校园智序 · 小序 智能体聊天氛围背景",
} as const;
