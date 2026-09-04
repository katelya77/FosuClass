function createSubmittingActivityPatch() {
  return {
    agentActivityState: "submitting",
    sendingStatusText: "正在建立任务",
    statusCapsuleText: "正在建立校园任务",
    statusCapsuleDetail: "服务端接收后会按真实运行事件更新状态。",
    statusCapsuleExpanded: true,
  };
}

function terminalActivityPatch(source, options) {
  var payload = source && typeof source === "object" ? source : {};
  var opts = options && typeof options === "object" ? options : {};
  if (opts.waitingConfirmation === true) {
    return {
      agentActivityState: "waiting_confirmation",
      sendingStatusText: "等待确认",
      statusCapsuleText: "等待确认 · 操作尚未执行",
      statusCapsuleDetail: "写操作只会在你确认并收到真实执行回执后完成。",
      statusCapsuleExpanded: true,
    };
  }

  var status = String(payload.status || payload.runStatus || "").toLowerCase();
  var errors = Array.isArray(payload.errors) ? payload.errors : [];
  var errorCount = Math.max(errors.length, Number(payload.errorCount || 0) || 0);
  var partial = payload.partialCompletion === true || status === "partial";
  var verification = payload.verification && typeof payload.verification === "object"
    ? payload.verification
    : null;
  var verificationOk = payload.verificationOk === true || (verification && verification.ok === true);
  var verificationFailed = payload.verificationOk === false || (verification && verification.ok === false);

  if (partial) {
    return {
      agentActivityState: "degraded",
      sendingStatusText: "部分完成",
      statusCapsuleText: "部分完成 · 仍有结果未取得",
      statusCapsuleDetail: "已返回可验证的部分结果；未完成项不会被伪装成成功。",
      statusCapsuleExpanded: true,
    };
  }
  if (payload.success === false || status === "failed" || status === "error" || verificationFailed) {
    return {
      agentActivityState: "network_error",
      sendingStatusText: "未完成",
      statusCapsuleText: "任务未能完成",
      statusCapsuleDetail: "结果验证或执行失败；系统没有把失败写成成功。",
      statusCapsuleExpanded: true,
    };
  }
  if (payload.fallback === true || status === "degraded") {
    return {
      agentActivityState: "degraded",
      sendingStatusText: payload.resultOrigin === "local_device" ? "本机结果" : "校园工具已完成",
      statusCapsuleText: payload.resultOrigin === "local_device" ? "本机结果 · 可联网重试" : "已完成 · 校园结果可用",
      statusCapsuleDetail: payload.resultOrigin === "local_device"
        ? "结果只来自本机缓存或确定性入口，没有伪装成服务端任务。"
        : "课表与校园事实已由确定性工具核验；复杂问法可稍后重试智能理解。",
      statusCapsuleExpanded: true,
    };
  }
  return {
    agentActivityState: "complete",
    sendingStatusText: "已完成",
    statusCapsuleText: verificationOk ? "完成 · 结果已核验" : "已完成",
    statusCapsuleDetail: verificationOk
      ? "结果已通过服务端验证并更新当前会话状态。"
      : "本次任务已结束，可以继续追问或执行卡片操作。",
    statusCapsuleExpanded: false,
  };
}

function activityPatchForResponse(response, options) {
  return terminalActivityPatch(response, options);
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
  if (type === "verification.started" || type === "verification.completed") {
    return {
      agentActivityState: "verifying",
      statusCapsuleText: text || "正在核验结果",
      statusCapsuleDetail: "只有通过验证的工具结果才会进入最终回答。",
    };
  }
  if (type === "tool.completed" || type === "result.verifying" || type === "response.composing") {
    return {
      agentActivityState: "composing",
      statusCapsuleText: text || "正在核验并整理结果",
      statusCapsuleDetail: "只有通过验证的工具结果才会进入最终回答。",
    };
  }
  if (type === "run.completed" || type === "run.degraded" || type === "run.failed") {
    return terminalActivityPatch(Object.assign({}, event, {
      status: event.status || (type === "run.degraded" ? "degraded" : (type === "run.failed" ? "failed" : "completed")),
      success: type === "run.failed" ? false : event.success,
      fallback: type === "run.degraded" || event.fallback === true,
    }));
  }
  if (type === "understanding.fallback" || type === "provider.failed") {
    return {
      agentActivityState: "degraded",
      statusCapsuleText: text || "正在改用校园工具继续处理",
      statusCapsuleDetail: "已有工具结果会保留；复杂理解恢复后仍可重试。",
    };
  }
  if (type === "run.status_unavailable") {
    return {
      agentActivityState: "composing",
      statusCapsuleText: text || "正在等待最终结果",
      statusCapsuleDetail: "已切换兼容通道继续处理，已取得的进度不会丢失。",
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
  activityPatchForResponse: activityPatchForResponse,
  createSubmittingActivityPatch: createSubmittingActivityPatch,
};
