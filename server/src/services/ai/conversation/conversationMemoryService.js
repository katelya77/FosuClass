/**
 * Conversation memory orchestration:
 * principal resolution, mode policy, context merge, persist after success.
 */
const {
  normalizeContextSlots,
  normalizeEvidenceRef,
  normalizeMemoryMode,
  normalizePendingClarification,
  normalizeRecentTurn,
  publicConversationView,
  publicMemoryStatus,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_CLOUD_SYNC_TTL_MS,
  nowIso,
  safeText,
} = require("./conversationSchema");
const { resolvePrincipal } = require("./conversationPrincipalService");
const { getConversationRepository } = require("./conversationRepository");
const { buildConversationSummary, buildTitleFromMessage } = require("./conversationSummaryService");
const { defaultUserPreferenceService } = require("./userPreferenceService");

function isNewTaskMessage(message = "") {
  const text = String(message || "").trim();
  if (!text) return false;
  if (/^(新建|创建|新开).*(对话|查询)/.test(text.replace(/\s+/g, ""))) return true;
  // Full new task phrases that should clear old pending clarification.
  return /^(帮我|请|麻烦)?(查|查询|找|看看|看一下)/.test(text) && text.length > 8
    && !/^(那|换成|另一个|还是|继续|再|改成)/.test(text);
}

function mergeContextPriority(input = {}) {
  const requestTimeContext = {
    term: input.requestContext && input.requestContext.term,
    releaseVersion: input.requestContext && input.requestContext.releaseVersion,
    currentTeachingWeek: input.requestContext && input.requestContext.currentTeachingWeek,
    todayWeekday: input.requestContext && input.requestContext.todayWeekday,
    todayDate: input.requestContext && input.requestContext.todayDate,
    currentPage: input.requestContext && input.requestContext.currentPage,
  };
  const messageSlots = normalizeContextSlots(input.messageSlots || {});
  const serverSlots = normalizeContextSlots(input.serverSlots || {});
  const clientSlots = normalizeContextSlots(input.clientSlots || {});
  const defaults = normalizeContextSlots(input.defaults || {});

  const merged = normalizeContextSlots(Object.assign({}, defaults, clientSlots, serverSlots));

  // Current request time / page safe context wins for term/release when present.
  Object.keys(requestTimeContext).forEach((key) => {
    if (requestTimeContext[key] !== undefined && requestTimeContext[key] !== null && requestTimeContext[key] !== "") {
      if (key === "currentTeachingWeek") merged.lastWeek = Number(requestTimeContext[key]) || merged.lastWeek;
      else if (key === "todayWeekday") merged.lastWeekday = Number(requestTimeContext[key]) || merged.lastWeekday;
      else if (key === "term") merged.term = safeText(requestTimeContext[key], 40);
      else if (key === "releaseVersion") merged.releaseVersion = safeText(requestTimeContext[key], 80);
    }
  });

  // Explicit message slots override everything older.
  Object.keys(messageSlots).forEach((key) => {
    const value = messageSlots[key];
    if (value === null || value === undefined || value === "") return;
    if (typeof value === "object" && !Object.keys(value).length) return;
    merged[key] = value;
  });

  // Term change invalidates old week/target pollution.
  if (serverSlots.term && merged.term && serverSlots.term !== merged.term) {
    if (!messageSlots.lastWeek && !messageSlots.week) {
      // keep request week if any
    }
  }
  if (input.clearPending) {
    // handled by caller
  }
  return merged;
}

function applyServerStateToContext(context = {}, state = null) {
  if (!state) return context;
  const next = Object.assign({}, context);
  const slots = state.contextSlots || {};
  if (!next.pendingClarification && state.pendingClarification) {
    next.pendingClarification = state.pendingClarification;
  }
  next.conversationSlots = slots;
  // Soft-fill missing client slots for follow-ups like "那周三呢"
  const softKeys = ["lastTargetType", "lastTargetName", "lastWeek", "lastWeekday", "type", "q", "week", "weekday", "term"];
  softKeys.forEach((key) => {
    if ((next[key] === undefined || next[key] === null || next[key] === "") && slots[key] != null && slots[key] !== "") {
      next[key] = slots[key];
    }
  });
  if (state.conversationSummary) next.conversationSummary = state.conversationSummary;
  return next;
}

function filterEvidenceRefsForRelease(refs, releaseVersion) {
  const list = Array.isArray(refs) ? refs : [];
  if (!releaseVersion) return list.slice(0, 8);
  return list.filter((item) => !item.releaseVersion || item.releaseVersion === releaseVersion).slice(0, 8);
}

class ConversationMemoryService {
  constructor(options = {}) {
    this.repository = options.repository || getConversationRepository(options);
    this.userPreferenceService = options.userPreferenceService || defaultUserPreferenceService;
  }

  resolvePrincipal(input = {}) {
    return resolvePrincipal({
      serverSession: input.serverSession,
      runtimeMode: input.runtimeMode,
      appid: input.appid,
    });
  }

  resolveMemoryMode(input = {}) {
    const principal = input.principal || this.resolvePrincipal(input);
    if (!principal.authenticated) return "local_only";
    const requested = normalizeMemoryMode(input.requestedMode || input.memoryMode, "");
    if (requested === "cloud_sync") {
      // cloud_sync must be explicit and previously enabled (or now requested true).
      if (input.explicitCloudSync === true || input.cloudSyncEnabled === true) return "cloud_sync";
      // If state already has cloud_sync, keep it unless turning off.
      if (input.existingMode === "cloud_sync" && input.disableCloudSync !== true) return "cloud_sync";
      if (requested === "cloud_sync" && input.allowCloudSyncRequest === true) return "cloud_sync";
    }
    if (requested === "local_only") return "local_only";
    if (requested === "session_state") return "session_state";
    if (input.existingMode && input.existingMode !== "local_only") {
      return normalizeMemoryMode(input.existingMode, "session_state");
    }
    return "session_state";
  }

  loadForChat(input = {}) {
    const principal = this.resolvePrincipal(input);
    const conversationId = String(input.conversationId || "").trim();
    if (!principal.authenticated || !conversationId) {
      return {
        principal,
        state: null,
        memory: publicMemoryStatus(null, { authenticated: principal.authenticated, mode: "local_only" }),
        context: input.context || {},
      };
    }

    let state = null;
    try {
      state = this.repository.get(principal.principalKey, conversationId);
    } catch (error) {
      state = null;
    }

    const mode = this.resolveMemoryMode({
      principal,
      existingMode: state && state.memoryPolicy && state.memoryPolicy.mode,
      requestedMode: input.memoryMode || input.context && input.context.memoryMode,
      explicitCloudSync: input.context && input.context.cloudSyncEnabled === true,
      cloudSyncEnabled: input.context && input.context.cloudSyncEnabled === true,
      allowCloudSyncRequest: input.context && input.context.cloudSyncEnabled === true,
    });

    if (mode === "local_only") {
      return {
        principal,
        state: null,
        memory: publicMemoryStatus(null, { authenticated: true, mode: "local_only" }),
        context: input.context || {},
      };
    }

    let context = applyServerStateToContext(input.context || {}, state);
    // session_state and cloud_sync both restore recent turns + working memory.
    if (mode === "cloud_sync" || mode === "session_state") {
      const clientRecent = Array.isArray(context.recentMessages) ? context.recentMessages : [];
      const serverRecent = state && Array.isArray(state.recentTurns)
        ? state.recentTurns.map((turn) => ({ role: turn.role, content: turn.text }))
        : [];
      const mergedRecent = [];
      clientRecent.concat(serverRecent).forEach((turn) => {
        const role = turn && turn.role === "user" ? "user" : "assistant";
        const content = safeText(turn && (turn.content || turn.text) || "", 400);
        if (!content) return;
        const previous = mergedRecent[mergedRecent.length - 1];
        if (previous && previous.role === role && previous.content === content) return;
        mergedRecent.push({ role, content });
      });
      context = Object.assign({}, context, {
        recentMessages: mergedRecent.slice(-12),
        workingMemory: state && state.workingMemory || context.workingMemory || null,
      });
      try {
        const cloudPreferences = this.userPreferenceService.getObject({ principal });
        context.userPreferences = Object.assign({}, context.userPreferences || {}, cloudPreferences, {
          localOnly: mode === "session_state",
        });
      } catch (_) {
        // Preference storage is an optional privacy-preserving layer. Chat remains usable.
      }
    }
    if (state && state.evidenceRefs) {
      context = Object.assign({}, context, {
        serverEvidenceRefs: filterEvidenceRefsForRelease(
          state.evidenceRefs,
          context.releaseVersion || ""
        ),
      });
    }
    if (input.message && isNewTaskMessage(input.message) && context.pendingClarification) {
      context = Object.assign({}, context, { pendingClarification: null, clearPendingClarification: true });
    }

    return {
      principal,
      state,
      memory: publicMemoryStatus(state, { authenticated: true, mode }),
      context,
    };
  }

  persistAfterSuccess(input = {}) {
    const principal = input.principal || this.resolvePrincipal(input);
    const conversationId = String(input.conversationId || "").trim();
    if (!principal.authenticated || !conversationId) {
      return publicMemoryStatus(null, { authenticated: principal.authenticated, mode: "local_only" });
    }
    // Cancelled runs and failures must not write long-term memory.
    if (input.failed === true || input.securityBlocked === true
      || input.cancelled === true || input.status === "cancelled") {
      return publicMemoryStatus(input.state || null, {
        authenticated: true,
        mode: input.memoryMode || "session_state",
      });
    }

    const mode = this.resolveMemoryMode({
      principal,
      existingMode: input.state && input.state.memoryPolicy && input.state.memoryPolicy.mode,
      requestedMode: input.memoryMode,
      explicitCloudSync: input.cloudSyncEnabled === true,
      cloudSyncEnabled: input.cloudSyncEnabled === true,
      allowCloudSyncRequest: input.cloudSyncEnabled === true,
    });
    if (mode === "local_only") {
      return publicMemoryStatus(null, { authenticated: true, mode: "local_only" });
    }

    const responseSlots = normalizeContextSlots(input.contextSlots || input.slots || {});
    const mergedSlots = mergeContextPriority({
      requestContext: input.context || {},
      messageSlots: responseSlots,
      serverSlots: input.state && input.state.contextSlots || {},
      clientSlots: input.context && input.context.conversationSlots || {},
    });

    const pendingClarification = input.clearPendingClarification
      ? null
      : normalizePendingClarification(input.pendingClarification || null);

    const evidenceRefs = filterEvidenceRefsForRelease(
      (Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [])
        .concat(input.evidence && input.evidence.sources || [])
        .map((item) => normalizeEvidenceRef(Object.assign({}, item, {
          releaseVersion: item.releaseVersion || (input.context && input.context.releaseVersion) || "",
          term: item.term || (input.context && input.context.term) || "",
          checkedAt: item.checkedAt || nowIso(),
        }))),
      input.context && input.context.releaseVersion || ""
    );

    // Prefer semantic summary from MemoryController; fall back to template.
    const summary = input.conversationSummary
      ? safeText(input.conversationSummary, 240)
      : buildConversationSummary({
        intent: input.intentName || mergedSlots.lastIntent,
        targetName: mergedSlots.lastTargetName || mergedSlots.q,
        week: mergedSlots.lastWeek || mergedSlots.week,
        weekday: mergedSlots.lastWeekday || mergedSlots.weekday,
        toolSource: mergedSlots.lastSource || "deterministic-tools",
      });

    const patch = {
      runtimeMode: principal.runtimeMode,
      title: safeText(input.title || (input.state && input.state.title) || buildTitleFromMessage(input.message), 80),
      contextSlots: mergedSlots,
      pendingClarification,
      conversationSummary: summary,
      evidenceRefs,
      lastRun: {
        runId: input.runId || "",
        intent: input.intentName || "",
        status: input.status || "completed",
        stepCount: Number(input.stepCount || 0) || 0,
        at: nowIso(),
      },
      memoryPolicy: {
        mode,
        cloudSyncEnabled: mode === "cloud_sync",
        updatedAt: nowIso(),
      },
      expiresAt: new Date(Date.now() + (mode === "cloud_sync" ? DEFAULT_CLOUD_SYNC_TTL_MS : DEFAULT_SESSION_TTL_MS)).toISOString(),
      recentTurns: [],
      workingMemory: input.workingMemory && typeof input.workingMemory === "object"
        ? input.workingMemory
        : (input.state && input.state.workingMemory) || null,
    };

    // session_state + cloud_sync both keep desensitized recent turns (≤12).
    if (mode === "cloud_sync" || mode === "session_state" || input.forceRecentTurns) {
      if (Array.isArray(input.recentTurns) && input.recentTurns.length) {
        patch.recentTurns = input.recentTurns.slice(-12).map(normalizeRecentTurn).filter((t) => t.text);
      } else {
        const previousTurns = input.state && Array.isArray(input.state.recentTurns) ? input.state.recentTurns : [];
        const turns = previousTurns.slice();
        if (input.message) {
          turns.push(normalizeRecentTurn({ role: "user", text: input.message, intent: input.intentName, at: nowIso() }));
        }
        if (input.answer) {
          turns.push(normalizeRecentTurn({ role: "assistant", text: input.answer, intent: input.intentName, at: nowIso() }));
        }
        patch.recentTurns = turns.slice(-12);
      }
    }

    try {
      const saved = this.repository.update(principal.principalKey, conversationId, patch, {
        createIfMissing: true,
        expectedRevision: input.expectedRevision,
        runtimeMode: principal.runtimeMode,
        memoryMode: mode,
      });
      return publicMemoryStatus(saved, { authenticated: true, mode });
    } catch (error) {
      if (error && error.code === "CONVERSATION_REVISION_CONFLICT") {
        // Do not fail the agent response; report non-persisted memory.
        return Object.assign(
          publicMemoryStatus(input.state || null, { authenticated: true, mode }),
          { persisted: false, conflict: true }
        );
      }
      return publicMemoryStatus(null, { authenticated: true, mode: "local_only" });
    }
  }

  listConversations(input = {}) {
    const principal = this.resolvePrincipal(input);
    if (!principal.authenticated) return { success: true, items: [], memory: publicMemoryStatus(null, { authenticated: false }) };
    const items = this.repository.list(principal.principalKey);
    return {
      success: true,
      items,
      memory: publicMemoryStatus(null, { authenticated: true, mode: "session_state" }),
    };
  }

  getConversation(input = {}) {
    const principal = this.resolvePrincipal(input);
    if (!principal.authenticated) {
      const error = new Error("Session required");
      error.code = "FOSU_SESSION_REQUIRED";
      error.statusCode = 401;
      throw error;
    }
    const state = this.repository.get(principal.principalKey, input.conversationId);
    if (!state) {
      const error = new Error("Conversation not found");
      error.code = "CONVERSATION_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    return {
      success: true,
      conversation: publicConversationView(state),
      memory: publicMemoryStatus(state, {
        authenticated: true,
        mode: state.memoryPolicy && state.memoryPolicy.mode,
      }),
      contextSlots: state.contextSlots,
      pendingClarification: state.pendingClarification,
      recentTurns: state.memoryPolicy && state.memoryPolicy.mode === "cloud_sync" ? state.recentTurns : [],
    };
  }

  patchConversation(input = {}) {
    const principal = this.resolvePrincipal(input);
    if (!principal.authenticated) {
      const error = new Error("Session required");
      error.code = "FOSU_SESSION_REQUIRED";
      error.statusCode = 401;
      throw error;
    }
    const conversationId = String(input.conversationId || "").trim();
    if (!conversationId || conversationId.length > 80) {
      const error = new Error("conversationId invalid");
      error.code = "CONVERSATION_ID_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const existing = this.repository.get(principal.principalKey, conversationId);
    const created = !existing;
    const patch = {
      runtimeMode: principal.runtimeMode,
    };
    if (input.title !== undefined) patch.title = safeText(input.title, 80);
    else if (created && input.title) patch.title = safeText(input.title, 80);
    if (input.memoryMode || input.memoryPolicy) {
      const mode = this.resolveMemoryMode({
        principal,
        existingMode: existing && existing.memoryPolicy && existing.memoryPolicy.mode,
        requestedMode: input.memoryMode || input.memoryPolicy && input.memoryPolicy.mode,
        explicitCloudSync: (input.memoryMode || input.memoryPolicy && input.memoryPolicy.mode) === "cloud_sync",
        allowCloudSyncRequest: (input.memoryMode || input.memoryPolicy && input.memoryPolicy.mode) === "cloud_sync",
        disableCloudSync: (input.memoryMode || input.memoryPolicy && input.memoryPolicy.mode) === "local_only"
          || (input.memoryMode || input.memoryPolicy && input.memoryPolicy.mode) === "session_state",
      });
      patch.memoryPolicy = {
        mode,
        cloudSyncEnabled: mode === "cloud_sync",
        updatedAt: nowIso(),
      };
      if (mode !== "cloud_sync") patch.recentTurns = [];
      if (input.deleteCloudData === true && mode !== "cloud_sync") {
        patch.recentTurns = [];
        patch.conversationSummary = "";
      }
    }
    // Safe upsert: first enable of session_state/cloud_sync for a local conversationId
    // must create a minimal server conversation bound to the current principal.
    const saved = this.repository.update(principal.principalKey, conversationId, patch, {
      createIfMissing: true,
      expectedRevision: created ? undefined : input.expectedRevision,
      runtimeMode: principal.runtimeMode,
      memoryMode: patch.memoryPolicy && patch.memoryPolicy.mode || "session_state",
    });
    return {
      success: true,
      created,
      upserted: true,
      conversation: publicConversationView(saved),
      memory: publicMemoryStatus(saved, {
        authenticated: true,
        mode: saved.memoryPolicy && saved.memoryPolicy.mode,
      }),
    };
  }

  deleteConversation(input = {}) {
    const principal = this.resolvePrincipal(input);
    if (!principal.authenticated) {
      const error = new Error("Session required");
      error.code = "FOSU_SESSION_REQUIRED";
      error.statusCode = 401;
      throw error;
    }
    return this.repository.delete(principal.principalKey, input.conversationId);
  }

  clearAllMemory(input = {}) {
    const principal = this.resolvePrincipal(input);
    if (!principal.authenticated) {
      const error = new Error("Session required");
      error.code = "FOSU_SESSION_REQUIRED";
      error.statusCode = 401;
      throw error;
    }
    return this.repository.clearPrincipal(principal.principalKey);
  }

  setMemoryPolicy(input = {}) {
    const principal = this.resolvePrincipal(input);
    if (!principal.authenticated) {
      const error = new Error("Session required");
      error.code = "FOSU_SESSION_REQUIRED";
      error.statusCode = 401;
      throw error;
    }
    const mode = this.resolveMemoryMode({
      principal,
      requestedMode: input.mode,
      explicitCloudSync: input.mode === "cloud_sync",
      allowCloudSyncRequest: input.mode === "cloud_sync",
    });
    if (mode === "local_only" && input.clearExisting === true) {
      this.repository.clearPrincipal(principal.principalKey);
      return {
        success: true,
        memory: publicMemoryStatus(null, { authenticated: true, mode: "local_only" }),
      };
    }
    if (input.conversationId) {
      return this.patchConversation({
        serverSession: input.serverSession,
        runtimeMode: principal.runtimeMode || input.runtimeMode,
        conversationId: input.conversationId,
        memoryMode: mode,
        title: input.title,
        deleteCloudData: input.clearExisting === true,
        expectedRevision: input.expectedRevision,
      });
    }
    return {
      success: true,
      memory: publicMemoryStatus(null, { authenticated: true, mode }),
    };
  }
}

const defaultMemoryService = new ConversationMemoryService();

module.exports = {
  ConversationMemoryService,
  applyServerStateToContext,
  defaultMemoryService,
  filterEvidenceRefsForRelease,
  isNewTaskMessage,
  mergeContextPriority,
};
