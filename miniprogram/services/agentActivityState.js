function createSubmittingActivityPatch() {
  return {
    agentActivityState: "submitting",
    sendingStatusText: "正在建立任务",
    statusCapsuleText: "正在建立校园任务",
    statusCapsuleDetail: "服务端接收后会按真实运行事件更新状态。",
    statusCapsuleExpanded: true,
  };
}

function activityPatchForRunEvent(status) {
  var event = status || {};
  var type = String(event.type || "");
  var text = String(event.text || event.label || "");
  if (type === "understanding.started") {
    return {
      agentActivityState: "understanding",
      statusCapsuleText: text || "正在理解你的目标",
      statusCapsuleDetail: "正在生成受约束的任务目标，不会直接选择任意工具。",
    };
  }
  if (type === "provider.started") {
    return {
      agentActivityState: "thinking",
      statusCapsuleText: text || "正在增强理解",
      statusCapsuleDetail: "推理层已真实开始；校园事实仍只取自受控工具。",
    };
  }
  if (type === "tool.started") {
    return {
      agentActivityState: "querying",
      statusCapsuleText: text || "正在读取校园数据",
      statusCapsuleDetail: "正在调用白名单工具并记录可验证结果。",
    };
  }
  if (type === "tool.completed" || type === "result.verifying" || type === "response.composing") {
    return {
      agentActivityState: "composing",
      statusCapsuleText: text || "正在核验并整理结果",
      statusCapsuleDetail: "只有通过验证的工具结果才会进入最终回复。",
    };
  }
  if (type === "understanding.fallback" || type === "provider.failed" || type === "run.degraded") {
    return {
      agentActivityState: "degraded",
      statusCapsuleText: text || "增强理解暂不可用，已安全降级",
      statusCapsuleDetail: "确定性工具结果会保留，失败不会被伪装成成功。",
    };
  }
  if (type === "run.failed" || type === "run.status_unavailable") {
    return {
      agentActivityState: "network_error",
      statusCapsuleText: text || "任务未能完成",
      statusCapsuleDetail: "可以检查网络后重试，已取得的本地数据不会丢失。",
    };
  }
  if (type === "run.completed") {
    return {
      agentActivityState: "complete",
      statusCapsuleText: text || "已完成",
      statusCapsuleDetail: "结果已核验并更新当前会话状态。",
    };
  }
  if (type === "planner.started" || type === "plan.created" || type === "plan.replan") {
    return {
      agentActivityState: "understanding",
      statusCapsuleText: text || "正在制定受约束计划",
      statusCapsuleDetail: "计划只能使用 Capability Manifest 允许的能力。",
    };
  }
  return {};
}

module.exports = {
  activityPatchForRunEvent: activityPatchForRunEvent,
  createSubmittingActivityPatch: createSubmittingActivityPatch,
};
