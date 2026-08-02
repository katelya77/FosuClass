(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgentPlatformLive = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createModule() {
  "use strict";

  function createLiveRefreshController(options) {
    const doc = options.document;
    const schedule = options.schedule || setInterval;
    const cancel = options.cancel || clearInterval;
    const loadOperations = options.loadOperations;
    const loadRuns = options.loadRuns;
    const loadAdvanced = options.loadAdvanced;
    const onStatus = typeof options.onStatus === "function" ? options.onStatus : function noop() {};
    const operationsIntervalMs = Math.max(1000, Number(options.operationsIntervalMs || 5000) || 5000);
    const runsIntervalMs = Math.max(1000, Number(options.runsIntervalMs || 3000) || 3000);
    let operationsTimer = null;
    let runsTimer = null;
    let operationsPending = null;
    let runsPending = null;
    let advancedPending = null;
    let advancedLoaded = false;
    let stopped = false;
    const health = { operations: null, runs: null };

    function visible() {
      return !doc || doc.hidden !== true;
    }

    function invoke(loader, key) {
      if (!visible() || typeof loader !== "function") return Promise.resolve(false);
      if (key === "operations" && operationsPending) return operationsPending;
      if (key === "runs" && runsPending) return runsPending;
      const task = Promise.resolve().then(loader);
      if (key === "operations") operationsPending = task;
      else runsPending = task;
      return task.finally(function clearPending() {
        if (key === "operations") operationsPending = null;
        else runsPending = null;
      });
    }

    function refreshOperations() {
      return invoke(loadOperations, "operations");
    }

    function refreshRuns() {
      return invoke(loadRuns, "runs");
    }

    async function refreshNow() {
      if (!visible()) {
        onStatus("paused");
        return [];
      }
      onStatus("refreshing");
      const result = await Promise.allSettled([refreshOperations(), refreshRuns()]);
      health.operations = result[0].status === "fulfilled";
      health.runs = result[1].status === "fulfilled";
      onStatus(health.operations && health.runs ? "live" : "retrying");
      return result;
    }

    function scheduledRefresh(key, loader) {
      if (!visible()) return Promise.resolve(false);
      return loader().then(function markHealthy(value) {
        health[key] = true;
        onStatus(health.operations === false || health.runs === false ? "retrying" : "live");
        return value;
      }, function markUnhealthy(error) {
        health[key] = false;
        onStatus("retrying");
        return Promise.reject(error);
      });
    }

    function handleVisibility() {
      if (!visible()) {
        onStatus("paused");
        return;
      }
      refreshNow().catch(function markRetry() { onStatus("retrying"); });
    }

    function start() {
      if (operationsTimer !== null || stopped) return;
      operationsTimer = schedule(function refreshOperationsTimer() {
        return scheduledRefresh("operations", refreshOperations).catch(function swallowScheduledFailure() { return false; });
      }, operationsIntervalMs);
      runsTimer = schedule(function refreshRunsTimer() {
        return scheduledRefresh("runs", refreshRuns).catch(function swallowScheduledFailure() { return false; });
      }, runsIntervalMs);
      if (doc && typeof doc.addEventListener === "function") doc.addEventListener("visibilitychange", handleVisibility);
    }

    async function bootstrap() {
      const result = await refreshNow();
      start();
      return result;
    }

    function ensureAdvanced() {
      if (advancedLoaded) return Promise.resolve(false);
      if (advancedPending) return advancedPending;
      if (typeof loadAdvanced !== "function") {
        advancedLoaded = true;
        return Promise.resolve(false);
      }
      advancedPending = Promise.resolve().then(loadAdvanced).then(function markLoaded(value) {
        advancedLoaded = true;
        return value;
      }).finally(function clearAdvancedPending() {
        advancedPending = null;
      });
      return advancedPending;
    }

    function stop() {
      stopped = true;
      if (operationsTimer !== null) cancel(operationsTimer);
      if (runsTimer !== null) cancel(runsTimer);
      operationsTimer = null;
      runsTimer = null;
      if (doc && typeof doc.removeEventListener === "function") doc.removeEventListener("visibilitychange", handleVisibility);
    }

    return Object.freeze({
      bootstrap,
      ensureAdvanced,
      refreshNow,
      refreshOperations,
      refreshRuns,
      start,
      stop,
    });
  }

  return Object.freeze({
    createLiveRefreshController,
  });
}));
