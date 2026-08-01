function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function timestamp(value) {
  if (value === undefined || value === null || value === "") return NaN;
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function createDeadline(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const hardLimitMs = Math.max(1, Math.min(15000, Number(options.hardLimitMs || 15000) || 15000));
  const requestedMs = Math.max(1, Number(options.timeoutMs || hardLimitMs) || hardLimitMs);
  const requestedStartedAt = timestamp(options.startedAt);
  const startedAt = Number.isFinite(requestedStartedAt) ? requestedStartedAt : now();
  const requestedDeadlineAt = timestamp(options.deadlineAt);
  const deadlineAt = Math.min(
    startedAt + hardLimitMs,
    Number.isFinite(requestedDeadlineAt) ? requestedDeadlineAt : startedAt + requestedMs,
  );

  function remainingMs() {
    return Math.max(0, deadlineAt - now());
  }

  function lease(stage, stageCapMs, finishReserveMs = 0) {
    const available = remainingMs() - Math.max(0, Number(finishReserveMs) || 0);
    if (available <= 0) throw codedError("DEADLINE_EXCEEDED", `No deadline budget remains for ${stage}`);
    return Object.freeze({
      stage: String(stage || "unknown").slice(0, 48),
      timeoutMs: Math.max(1, Math.floor(Math.min(available, Math.max(1, Number(stageCapMs) || available)))),
      deadlineAt,
      remainingMs: remainingMs(),
    });
  }

  return Object.freeze({
    startedAt,
    deadlineAt,
    hardLimitMs,
    remainingMs,
    lease,
  });
}

function createStageSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const abortFromParent = () => controller.abort(parentSignal && parentSignal.reason);
  if (parentSignal && parentSignal.aborted) abortFromParent();
  else if (parentSignal) parentSignal.addEventListener("abort", abortFromParent, { once: true });
  timer = setTimeout(() => {
    timedOut = true;
    controller.abort(codedError("PROVIDER_TIMEOUT", "Provider stage timed out"));
  }, Math.max(1, Number(timeoutMs) || 1));
  if (typeof timer.unref === "function") timer.unref();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (parentSignal) parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

module.exports = {
  createDeadline,
  createStageSignal,
};
