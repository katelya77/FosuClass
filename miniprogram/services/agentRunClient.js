/**
 * Agent Run API client: create → poll events → result / cancel.
 */
const request = require("../utils/request");

function safeText(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createRun(payload = {}) {
  const response = await request.post("/api/ai/agent/runs", {
    message: safeText(payload.message, 2000),
    context: payload.context || {},
    protocolVersion: payload.protocolVersion || "agent.v2",
    requestId: payload.requestId || "",
    conversationId: payload.conversationId || "",
    memoryMode: payload.memoryMode || (payload.context && payload.context.memoryMode) || "local_only",
    cloudSyncEnabled: payload.cloudSyncEnabled === true
      || (payload.context && payload.context.cloudSyncEnabled === true),
  }, {
    showLoading: false,
    silentError: true,
    timeout: 15000,
    retries: 0,
    dedupe: false,
  });
  if (!response || !response.runId) {
    const error = new Error(response && response.message || "RUN_CREATE_FAILED");
    error.code = response && response.code || "RUN_CREATE_FAILED";
    error.response = response;
    throw error;
  }
  return response;
}

async function getRun(runId, options = {}) {
  const id = encodeURIComponent(safeText(runId, 96));
  const afterSequence = Math.max(0, Number(options.afterSequence || 0) || 0);
  const pollToken = encodeURIComponent(safeText(options.pollToken, 128));
  const path = `/api/ai/agent/runs/${id}?afterSequence=${afterSequence}${pollToken ? `&pollToken=${pollToken}` : ""}`;
  return request.get(path, {}, {
    showLoading: false,
    silentError: true,
    timeout: 12000,
    retries: 0,
    dedupe: false,
  });
}

async function cancelRun(runId, pollToken) {
  const id = encodeURIComponent(safeText(runId, 96));
  try {
    return await request.post(`/api/ai/agent/runs/${id}/cancel`, {
      pollToken: safeText(pollToken, 128),
    }, {
      showLoading: false,
      silentError: true,
      timeout: 8000,
      retries: 0,
      dedupe: false,
    });
  } catch (error) {
    return { success: false, error: error && error.message || "CANCEL_FAILED" };
  }
}

/**
 * Poll until terminal status or timeout. Invokes onEvents for new events.
 */
async function pollRunUntilDone(runId, pollToken, options = {}) {
  const onEvents = options.onEvents || (() => {});
  const onStatus = options.onStatus || (() => {});
  const shouldCancel = options.shouldCancel || (() => false);
  const maxWaitMs = Math.max(5000, Number(options.maxWaitMs || 45000) || 45000);
  const started = Date.now();
  let afterSequence = 0;
  let lastStatus = "queued";

  while (Date.now() - started < maxWaitMs) {
    if (shouldCancel()) {
      await cancelRun(runId, pollToken);
      return { status: "cancelled", events: [], result: null, cancelled: true };
    }
    let view;
    try {
      view = await getRun(runId, { pollToken, afterSequence });
    } catch (error) {
      await sleep(500);
      continue;
    }
    if (!view || view.success === false) {
      await sleep(500);
      continue;
    }
    lastStatus = view.status || lastStatus;
    const events = Array.isArray(view.events) ? view.events : [];
    if (events.length) {
      afterSequence = events[events.length - 1].sequence || afterSequence;
      onEvents(events);
      const latest = events[events.length - 1];
      if (latest && latest.label) {
        onStatus({
          type: latest.type,
          text: latest.label,
          event: latest,
        });
      }
    }
    if (["completed", "degraded", "failed", "cancelled"].includes(String(view.status || ""))) {
      return {
        status: view.status,
        events,
        result: view.result || null,
        cancelled: view.status === "cancelled",
      };
    }
    await sleep(Math.max(200, Number(view.nextPollMs || 400) || 400));
  }
  return {
    status: lastStatus || "timeout",
    events: [],
    result: null,
    timeout: true,
  };
}

/**
 * 回传客户端 Action 执行回执（Receipt）。服务端凭此验证真实执行结果并提交
 * 记忆变更（workingMemory.currentScheduleTarget / contextSlots 等）。
 * 无 success Receipt 时服务端不得声称设置成功。
 */
async function postActionReceipt(payload = {}) {
  const target = payload.appliedTarget && typeof payload.appliedTarget === "object"
    ? payload.appliedTarget
    : {};
  try {
    return await request.post("/api/ai/agent/action-receipts", {
      command: safeText(payload.command, 40),
      runId: safeText(payload.runId, 100),
      conversationId: safeText(payload.conversationId, 100),
      status: safeText(payload.status, 24),
      appliedTarget: {
        type: safeText(target.type, 24),
        detailId: safeText(target.detailId, 128),
        name: safeText(target.name, 120),
        term: safeText(target.term, 40),
      },
      errorCode: safeText(payload.errorCode, 80),
      memoryMode: safeText(payload.memoryMode, 24),
      cloudSyncEnabled: payload.cloudSyncEnabled === true,
    }, {
      showLoading: false,
      silentError: true,
      timeout: 8000,
      retries: 0,
      dedupe: false,
    });
  } catch (error) {
    return { success: false, error: error && error.message || "RECEIPT_FAILED" };
  }
}

module.exports = {
  cancelRun,
  createRun,
  getRun,
  pollRunUntilDone,
  postActionReceipt,
};
