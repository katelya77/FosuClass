const APP_SERVICE = "@xiaofu-agent/agent-server";
const TERMINAL_TYPES = new Set(["run.completed", "run.degraded", "run.failed", "run.cancelled"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requireMethod(owner, method, dependencyName) {
  if (!owner || typeof owner[method] !== "function") {
    throw codedError("AGENT_RUN_HANDLER_DEPENDENCY_INVALID", `${dependencyName}.${method} is required`);
  }
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function requestContext(body = {}) {
  const context = Object.assign({}, body.context || {});
  if (body.memoryMode) context.memoryMode = body.memoryMode;
  if (body.cloudSyncEnabled === true) context.cloudSyncEnabled = true;
  return context;
}

function messageRequired(res) {
  return res.status(400).json({
    success: false,
    code: "MESSAGE_REQUIRED",
    message: "请输入要咨询的问题。",
    serverTime: new Date().toISOString(),
  });
}

function terminalTypeFor(status) {
  if (status === "cancelled") return "run.cancelled";
  if (status === "degraded") return "run.degraded";
  if (status === "failed") return "run.failed";
  return "run.completed";
}

function terminalSummary(payload, runtimeMode, status) {
  return {
    type: terminalTypeFor(status),
    runtimeMode,
    status: payload && payload.status || status,
    success: payload ? payload.success !== false : status !== "failed",
    fallback: Boolean(payload && payload.fallback),
    partialCompletion: Boolean(payload && (payload.partialCompletion === true || payload.status === "partial")),
    verificationOk: payload && payload.verification && payload.verification.ok === true,
    errorCount: payload && Array.isArray(payload.errors) ? payload.errors.length : 0,
    reasonCode: status === "degraded" ? String(payload && payload.fallbackReason || "").slice(0, 80) : "",
  };
}

function attachTransport(payload, path, diagnostics = {}) {
  return Object.assign({}, payload || {}, {
    transport: Object.freeze({
      appService: APP_SERVICE,
      path,
      runRepository: diagnostics.runRepository || "run-repository",
      idempotencyKeyAccepted: diagnostics.idempotencyKeyAccepted === true,
    }),
  });
}

function createRunHandlers(options = {}) {
  const platform = options.platform;
  const runRepository = options.runRepository;
  const protocol = options.protocol;
  const agui = options.agui;
  const buildFailureResponse = options.buildFailureResponse;
  const log = typeof options.log === "function" ? options.log : () => {};
  const schedule = typeof options.schedule === "function" ? options.schedule : setImmediate;
  const resolvePrincipal = typeof options.resolvePrincipal === "function"
    ? options.resolvePrincipal
    : () => ({ repositoryPrincipal: null, runtimePrincipal: null });
  const resolvePollCredential = typeof options.resolvePollCredential === "function"
    ? options.resolvePollCredential
    : (req) => String(req && req.query && req.query.pollToken || req && req.body && req.body.pollToken || "");
  const runRepositoryId = String(options.runRepositoryId || "run-repository").slice(0, 100);

  requireMethod(platform, "executeTurn", "platform");
  ["createRun", "createEventEmitter", "getRunView", "cancelRun", "isCancelled", "setResult", "statusFromResult"]
    .forEach((method) => requireMethod(runRepository, method, "runRepository"));
  requireMethod(protocol, "createRequestId", "protocol");
  requireMethod(agui, "mapRunToAguiEvents", "agui");
  requireMethod(agui, "serializeSse", "agui");
  if (typeof buildFailureResponse !== "function") {
    throw codedError("AGENT_RUN_FAILURE_BUILDER_REQUIRED");
  }

  const controllers = new Map();

  function runtimeModeFor(req) {
    return String(req && req.agentRuntimeDecision && req.agentRuntimeDecision.runtimeMode || "public");
  }

  function platformInput(req, overrides = {}) {
    const body = req.body || {};
    const principal = resolvePrincipal(req) || {};
    return Object.assign({
      message: String(body.message || "").trim(),
      context: requestContext(body),
      protocolVersion: body.protocolVersion,
      requestId: String(body.requestId || protocol.createRequestId()).slice(0, 96),
      conversationId: String(body.conversationId || "").slice(0, 96),
      serverSession: principal.runtimePrincipal || principal.repositoryPrincipal || null,
    }, overrides);
  }

  function orderedEmitter(emit) {
    let terminal = null;
    return {
      onEvent(event = {}) {
        if (TERMINAL_TYPES.has(String(event.type || ""))) {
          terminal = event;
          return null;
        }
        return emit(event);
      },
      terminal() {
        return terminal;
      },
    };
  }

  async function executeCompat(req, path, collectEvents) {
    const input = platformInput(req);
    const events = [];
    const ordered = orderedEmitter((event) => {
      if (collectEvents) events.push(event);
    });
    try {
      const payload = attachTransport(await platform.executeTurn(Object.assign({}, input, {
        onEvent: ordered.onEvent,
      })), path, { runRepository: runRepositoryId });
      const status = runRepository.statusFromResult(payload);
      events.push(Object.assign({}, ordered.terminal() || {}, terminalSummary(payload, payload.runtimeMode || runtimeModeFor(req), status)));
      return { payload, events, input };
    } catch (error) {
      const failure = attachTransport(buildFailureResponse(input, error), path, {
        runRepository: runRepositoryId,
      });
      events.push(Object.assign({}, ordered.terminal() || {}, terminalSummary(failure, runtimeModeFor(req), "failed")));
      return { payload: failure, events, input, error };
    }
  }

  async function chatCompat(req, res) {
    noStore(res);
    if (!String(req.body && req.body.message || "").trim()) return messageRequired(res);
    const execution = await executeCompat(req, "chat", false);
    log(execution.error ? "ai-agent-chat-failed" : "ai-agent-chat", {
      metrics: execution.payload.metrics || {},
      provider: execution.payload.safety && execution.payload.safety.provider,
      toolCalls: execution.payload.toolCalls,
      memoryMode: execution.payload.memory && execution.payload.memory.mode,
      code: execution.error && String(execution.error.code || "AGENT_SERVICE_UNAVAILABLE").slice(0, 80),
    });
    return res.status(200).json(execution.payload);
  }

  async function aguiCompat(req, res) {
    noStore(res);
    if (!String(req.body && req.body.message || "").trim()) return messageRequired(res);
    const execution = await executeCompat(req, "agui", true);
    const payload = execution.payload;
    const conversationId = String(req.body.conversationId || payload.conversationId || "").slice(0, 120);
    const runId = String(payload.runId || payload.requestId || req.body.requestId || "agui-run").slice(0, 120);
    const events = agui.mapRunToAguiEvents({
      conversationId,
      runId,
      events: execution.events,
      response: payload,
      answer: payload.answer,
      cards: payload.cards,
      actionCommands: payload.actionCommands,
      runtimeMode: payload.runtimeMode || (payload.safety && payload.safety.runtimeMode),
      failed: Boolean(execution.error),
      error: execution.error,
    });
    log(execution.error ? "ai-agent-agui-failed" : "ai-agent-agui", {
      eventCount: events.length,
      runId,
      provider: payload.safety && payload.safety.provider,
      code: execution.error && String(execution.error.code || "AGUI_FAILED").slice(0, 80),
    });
    const wantStream = req.body.stream === true || String(req.headers.accept || "").includes("text/event-stream");
    if (wantStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("X-Accel-Buffering", "no");
      return res.status(200).send(agui.serializeSse(events));
    }
    return res.status(200).json({
      success: !execution.error,
      protocol: "ag-ui",
      threadId: conversationId,
      runId,
      events,
      response: payload,
      serverTime: new Date().toISOString(),
    });
  }

  function createRun(req, res) {
    noStore(res);
    const body = req.body || {};
    const message = String(body.message || "").trim();
    if (!message) return messageRequired(res);
    const runtimeMode = runtimeModeFor(req);
    const requestId = String(body.requestId || protocol.createRequestId()).slice(0, 96);
    const conversationId = String(body.conversationId || "").slice(0, 96);
    const created = runRepository.createRun({
      serverSession: (resolvePrincipal(req) || {}).repositoryPrincipal || null,
      runtimeMode,
      requestId,
      conversationId,
    });
    const controller = new AbortController();
    controllers.set(created.runId, controller);
    const idempotencyKeyAccepted = Boolean(String(body.idempotencyKey || "").trim());

    schedule(async () => {
      const repositoryEmit = runRepository.createEventEmitter(created.runId, runtimeMode);
      const ordered = orderedEmitter(repositoryEmit);
      const input = platformInput(req, {
        message,
        requestId,
        conversationId,
        runId: created.runId,
        signal: controller.signal,
        onEvent: ordered.onEvent,
      });
      try {
        const payload = attachTransport(await platform.executeTurn(input), "run", {
          runRepository: runRepositoryId,
          idempotencyKeyAccepted,
        });
        if (runRepository.isCancelled(created.runId)) {
          runRepository.setResult(created.runId, null, "cancelled");
          return;
        }
        const status = runRepository.statusFromResult(payload);
        repositoryEmit(Object.assign({}, ordered.terminal() || {}, terminalSummary(payload, runtimeMode, status)));
        runRepository.setResult(created.runId, payload, status);
      } catch (error) {
        if (runRepository.isCancelled(created.runId) || error && error.code === "ABORTED") {
          runRepository.setResult(created.runId, null, "cancelled");
          return;
        }
        const failure = attachTransport(buildFailureResponse(input, error), "run", {
          runRepository: runRepositoryId,
          idempotencyKeyAccepted,
        });
        repositoryEmit(Object.assign({}, ordered.terminal() || {}, terminalSummary(failure, runtimeMode, "failed")));
        runRepository.setResult(created.runId, failure, "failed");
      } finally {
        controllers.delete(created.runId);
      }
    });

    return res.status(202).json({
      success: true,
      appService: APP_SERVICE,
      runId: created.runId,
      pollToken: created.pollToken,
      status: created.status,
      nextPollMs: created.nextPollMs,
      expiresAt: created.expiresAt,
      diagnostics: {
        idempotencyKeyAccepted,
        runRepository: runRepositoryId,
      },
      serverTime: new Date().toISOString(),
    });
  }

  function getRun(req, res) {
    noStore(res);
    const view = runRepository.getRunView(req.params.runId, {
      pollToken: resolvePollCredential(req),
      serverSession: (resolvePrincipal(req) || {}).repositoryPrincipal || null,
      afterSequence: req.query.afterSequence,
    });
    if (!view.ok) {
      return res.status(view.status || 404).json({
        success: false,
        code: view.code || "RUN_NOT_FOUND",
        message: "无法读取该运行任务。",
        serverTime: new Date().toISOString(),
      });
    }
    return res.json({
      success: true,
      appService: APP_SERVICE,
      runId: view.runId,
      status: view.status,
      events: view.events,
      result: view.result,
      nextPollMs: view.nextPollMs,
      checkedAt: view.checkedAt,
      serverTime: new Date().toISOString(),
    });
  }

  function cancelRun(req, res) {
    noStore(res);
    const result = runRepository.cancelRun(req.params.runId, {
      pollToken: resolvePollCredential(req),
      serverSession: (resolvePrincipal(req) || {}).repositoryPrincipal || null,
    });
    if (!result.ok) {
      return res.status(result.status || 404).json({
        success: false,
        code: result.code || "RUN_NOT_FOUND",
        message: "无法取消该运行任务。",
        serverTime: new Date().toISOString(),
      });
    }
    const controller = controllers.get(String(req.params.runId || ""));
    if (controller && !controller.signal.aborted) controller.abort();
    return res.json({
      success: true,
      appService: APP_SERVICE,
      runId: req.params.runId,
      status: result.status || "cancelled",
      alreadyFinished: result.alreadyFinished === true,
      serverTime: new Date().toISOString(),
    });
  }

  function diagnostics() {
    return Object.freeze({
      appService: APP_SERVICE,
      platform: platform.diagnostics ? platform.diagnostics() : {},
      runRepository: runRepositoryId,
      activeRunCount: controllers.size,
    });
  }

  return Object.freeze({
    createRun,
    getRun,
    cancelRun,
    chatCompat,
    aguiCompat,
    diagnostics,
  });
}

module.exports = {
  APP_SERVICE,
  createRunHandlers,
};
