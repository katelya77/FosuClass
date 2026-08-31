import verifiedWidgetCapture from "../../../final-delivery/qa/final-cut/4174-native-adp-widget-1440x900.png";

export interface VerifiedReplayStep {
  label: string;
  detail: string;
  kind: "user" | "main" | "child" | "tool" | "widget";
}

/**
 * Frozen anonymous submission evidence used only for clearly labeled replay.
 *
 * This is deliberately a replay descriptor, not a synthetic ADP response. It
 * points at the captured browser result from a previously successful, real SSE
 * conversation. The replay never calls /api/adp/chat and never constructs a
 * Widget.View locally.
 */
export const VERIFIED_REPLAY = Object.freeze({
  label: "已核验实录回放",
  capturedAt: "2026-08-24",
  question: "未来四周教师负载最高的是谁？",
  answer: "Top1 为教师025：未来四周 56 课次、112 课时。",
  evidenceSha256: "10853f04970650613939caf6f5ef0ebad83c0fc80b0d8534b13688cedc9b22fb",
  image: verifiedWidgetCapture,
  agents: ["小序-主协调", "小序-校园洞察"],
  tools: [
    "校园智序-CampusTools/campus_overview",
    "校园智序-CampusTools/campus_teacher_load_query",
  ],
  widgetId: "601418106a374b2eb7de54c65a3de7e0",
  steps: [
    { label: "用户", detail: "提出未来四周负载排名问题", kind: "user" },
    { label: "小序·主协调", detail: "理解任务并转交校园洞察 Agent", kind: "main" },
    { label: "小序·校园洞察", detail: "拆解全校概览与教师负载查询", kind: "child" },
    { label: "CampusTools", detail: "确定性计算 overview + teacher_load_query", kind: "tool" },
    { label: "已核验结果卡", detail: "平台返回结构化结果并完成官方渲染", kind: "widget" },
  ] satisfies VerifiedReplayStep[],
});
