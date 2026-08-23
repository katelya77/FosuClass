/**
 * live-demo/prompts.ts —— 正式 Demo Prompt Presets（仅公开任务文本，无任何凭据）。
 * 用于腾讯 ADP 真机演示与 LiveDemoCue 复制；绝不写入任何 AppKey/Secret/Token。
 */

export interface LiveDemoPrompt {
  key: string;
  label: string;
  /** 预期证明点 */
  proves: string;
  prompt: string;
}

export const LIVE_DEMO_PROMPTS: LiveDemoPrompt[] = [
  {
    key: "risk",
    label: "Demo 1 · 风险",
    proves: "自然语言 → 主编排 → 课表事实 → 风险规划 → Widget 结果",
    prompt: "查看教师003第1周课表，并检查他的跨校区赶场风险。",
  },
  {
    key: "collaboration",
    label: "Demo 2 · 协同",
    proves: "多人 × 时间 × 空间的联动计算",
    prompt: "帮教师005、教师006、教师014寻找第1周周四上午的共同空闲，并推荐一间满足需求的教室。",
  },
  {
    key: "reschedule",
    label: "Demo 3 · 模拟调课",
    proves: "What-if → 自动选空间 → 约束核验 → 风险保留 → 不修改真实课表",
    prompt: "模拟把2025级计算机类01班第1周周一第5-6节的数据结构课调整到第1周周四第7-8节，不指定教室，请帮我自动选择合适教室，并检查可行性和风险。",
  },
  {
    key: "insight-1",
    label: "Demo 4 · 下钻第一问",
    proves: "全局负载洞察",
    prompt: "未来四周教师负载最高的是谁？",
  },
  {
    key: "insight-2",
    label: "Demo 5 · 下钻第二问",
    proves: "Multi-turn 延续：查看 Top1 课表",
    prompt: "看一下Top1的课表",
  },
  {
    key: "insight-3",
    label: "Demo 6 · 下钻第三问",
    proves: "Multi-turn 延续：检查冲突与赶场",
    prompt: "检查他的课程冲突和跨校区赶场风险",
  },
];
