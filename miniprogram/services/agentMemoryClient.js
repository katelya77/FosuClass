/**
 * Cloud memory client for 小佛助手.
 * Uses existing request + session headers; never stores OpenID.
 */
const http = require("../utils/request");
const agentClientErrorMapper = require("./agentClientErrorMapper");
const platform = require("../utils/platform");

function safeText(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function withEnvQuery(path) {
  const envVersion = encodeURIComponent(platform.getMiniProgramEnvVersion());
  const joiner = path.indexOf("?") >= 0 ? "&" : "?";
  return `${path}${joiner}envVersion=${envVersion}`;
}

function requestOptions(extra = {}) {
  return Object.assign({
    showLoading: false,
    silentError: true,
    timeout: 12000,
    retries: 1,
    dedupe: false,
  }, extra);
}

function mapError(payload, fallbackCode) {
  const code = (payload && (payload.code || payload.errorCode)) || fallbackCode;
  const message = payload && (payload.message || payload.error || payload.errMsg);
  const mapped = agentClientErrorMapper.mapAgentError({ code, message }, agentClientErrorMapper.userMessage(fallbackCode));
  return { code: mapped.code, error: mapped.userMessage };
}

const MEMORY_REVISION_CONFLICT_CODES = ["MEMORY_REVISION_CONFLICT", "CONVERSATION_REVISION_CONFLICT"];
const MEMORY_NOT_FOUND_CODES = ["MEMORY_NOT_FOUND", "EPISODE_NOT_FOUND", "CONVERSATION_NOT_FOUND"];
const MEMORY_CONFLICT_MESSAGE = "记忆已在其他设备更新，请刷新记忆列表后重试";
const MEMORY_REFRESH_FAILED_MESSAGE = "记忆状态刷新失败，请检查网络后重试";
const MEMORY_TARGET_GONE_MESSAGE = "该记忆已不存在，请刷新列表后重新确认";

function rawErrorCode(error) {
  return (error && (error.reasonCode || error.code || error.errorCode)) || "";
}

/**
 * Failure result for memory mutations. Beyond the user-safe Chinese message it
 * preserves the raw HTTP status / payload code so withMemoryRevisionRetry can
 * classify 409 vs 404 vs everything else without re-parsing messages.
 */
function failureResult(error, fallbackCode, extra) {
  const mapped = mapError(error, fallbackCode);
  return Object.assign({
    success: false,
    error: mapped.error,
    code: mapped.code,
    statusCode: Number(error && error.statusCode) || 0,
    reasonCode: rawErrorCode(error),
  }, extra || {});
}

function isRevisionConflictResult(result) {
  if (!result || result.success !== false) return false;
  if (Number(result.statusCode) === 409) return true;
  const code = result.reasonCode || result.code || "";
  return MEMORY_REVISION_CONFLICT_CODES.indexOf(code) >= 0;
}

function isNotFoundResult(result) {
  if (!result || result.success !== false) return false;
  if (Number(result.statusCode) === 404) return true;
  const code = result.reasonCode || result.code || "";
  return MEMORY_NOT_FOUND_CODES.indexOf(code) >= 0;
}

const RECENT_TURN_ROLES = ["user", "assistant"];
const MAX_RECENT_TURN_TEXT = 400;

/**
 * recentTurns normalization at the client boundary: server `{role, text}` turns
 * become `{role, content}` messages, order preserved. Returns null when the
 * field is absent (caller may then fall back to legacy conversation.messages);
 * an empty array stays empty — "no recoverable messages" must not fall back.
 * Entries outside the role whitelist or without text are safely ignored; no
 * system/execution messages are ever fabricated here.
 */
function normalizeRecentTurns(recentTurns) {
  if (!Array.isArray(recentTurns)) return null;
  return recentTurns
    .map((turn) => {
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) return null;
      if (RECENT_TURN_ROLES.indexOf(turn.role) < 0) return null;
      const content = safeText(turn.text != null ? turn.text : turn.content, MAX_RECENT_TURN_TEXT);
      if (!content) return null;
      return { role: turn.role, content };
    })
    .filter(Boolean);
}

async function listCloudConversations() {
  try {
    const response = await http.get(withEnvQuery("/api/ai/agent/conversations"), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "LIST_FAILED");
      return { success: false, conversations: [], error: mapped.error, code: mapped.code };
    }
    const conversations = Array.isArray(response.conversations)
      ? response.conversations
      : (Array.isArray(response.items)
        ? response.items
        : (Array.isArray(response.data) ? response.data : []));
    return {
      success: true,
      conversations,
      memory: response.memory || null,
    };
  } catch (error) {
    const mapped = mapError(error, "LIST_FAILED");
    return { success: false, conversations: [], error: mapped.error, code: mapped.code };
  }
}

async function getCloudConversation(conversationId) {
  const id = encodeURIComponent(safeText(conversationId, 96));
  if (!id) {
    const mapped = mapError({ code: "CONVERSATION_ID_REQUIRED" }, "CONVERSATION_ID_REQUIRED");
    return { success: false, conversation: null, error: mapped.error, code: mapped.code };
  }
  try {
    const response = await http.get(withEnvQuery(`/api/ai/agent/conversations/${id}`), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "GET_FAILED");
      return { success: false, conversation: null, error: mapped.error, code: mapped.code };
    }
    const source = response.conversation || response.data || null;
    // recentTurns（顶层、{role,text}）是恢复消息的权威来源：存在且为数组即权威
    // （空数组 = 无可恢复消息，不回退其他来源）；仅缺失时兼容旧 conversation.messages。
    const recentTurns = normalizeRecentTurns(response.recentTurns);
    let conversation = null;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      conversation = Object.assign({}, source);
      if (recentTurns) {
        conversation.messages = recentTurns;
      } else if (Array.isArray(conversation.messages)) {
        conversation.messages = conversation.messages.slice();
      } else {
        // 载荷不携带消息（非消息事实源），保持缺失而非伪造空数组语义
        delete conversation.messages;
      }
      if (conversation.contextSlots === undefined && response.contextSlots && typeof response.contextSlots === "object") {
        conversation.contextSlots = response.contextSlots;
      }
    }
    return {
      success: true,
      conversation,
      memory: response.memory || null,
      contextSlots: response.contextSlots || null,
      pendingClarification: response.pendingClarification || null,
      recentTurns: recentTurns || [],
    };
  } catch (error) {
    const mapped = mapError(error, "GET_FAILED");
    return { success: false, conversation: null, error: mapped.error, code: mapped.code };
  }
}

async function updateMemoryPolicy(input = {}) {
  const mode = safeText(input.mode || input.memoryMode, 32);
  const conversationId = safeText(input.conversationId, 96);
  try {
    const response = await http.post(withEnvQuery("/api/ai/agent/memory-policy"), {
      mode,
      conversationId,
      title: safeText(input.title, 80),
      clearExisting: input.clearExisting === true,
      expectedRevision: input.expectedRevision,
    }, requestOptions({ timeout: 15000 }));
    if (!response || response.success === false) {
      const mapped = mapError(response, "MEMORY_POLICY_FAILED");
      return {
        success: false,
        error: mapped.error,
        code: mapped.code,
      };
    }
    return {
      success: true,
      memory: response.memory || response,
      conversation: response.conversation || null,
      created: response.created === true,
      upserted: response.upserted === true,
    };
  } catch (error) {
    const mapped = mapError(error, "MEMORY_POLICY_FAILED");
    return { success: false, error: mapped.error, code: mapped.code };
  }
}

async function patchCloudConversation(conversationId, body = {}) {
  const id = encodeURIComponent(safeText(conversationId, 96));
  if (!id) {
    const mapped = mapError({ code: "CONVERSATION_ID_REQUIRED" }, "CONVERSATION_ID_REQUIRED");
    return { success: false, error: mapped.error, code: mapped.code };
  }
  try {
    const response = await http.request(withEnvQuery(`/api/ai/agent/conversations/${id}`), "PATCH", body, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "PATCH_FAILED");
      return { success: false, error: mapped.error, code: mapped.code };
    }
    return { success: true, conversation: response.conversation || response, memory: response.memory || null };
  } catch (error) {
    const mapped = mapError(error, "PATCH_FAILED");
    return { success: false, error: mapped.error, code: mapped.code };
  }
}

async function renameCloudConversation(conversationId, title, expectedRevision) {
  return patchCloudConversation(conversationId, {
    title: safeText(title, 80),
    expectedRevision,
  });
}

async function deleteCloudConversation(conversationId) {
  const id = encodeURIComponent(safeText(conversationId, 96));
  if (!id) {
    const mapped = mapError({ code: "CONVERSATION_ID_REQUIRED" }, "CONVERSATION_ID_REQUIRED");
    return { success: false, error: mapped.error, code: mapped.code };
  }
  try {
    const response = await http.request(withEnvQuery(`/api/ai/agent/conversations/${id}`), "DELETE", {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "DELETE_FAILED");
      return { success: false, error: mapped.error, code: mapped.code };
    }
    return { success: true };
  } catch (error) {
    const mapped = mapError(error, "DELETE_FAILED");
    return { success: false, error: mapped.error, code: mapped.code };
  }
}

function revisionBody(expectedRevision) {
  const value = expectedRevision && typeof expectedRevision === "object"
    ? expectedRevision.expectedRevision
    : expectedRevision;
  return value === undefined || value === null ? {} : { expectedRevision: value };
}

function pageQuery(path, input = {}) {
  const params = [];
  if (input.page !== undefined) params.push(`page=${encodeURIComponent(input.page)}`);
  if (input.pageSize !== undefined) params.push(`pageSize=${encodeURIComponent(input.pageSize)}`);
  if (input.includeInactive === true) params.push("includeInactive=true");
  return params.length ? `${path}?${params.join("&")}` : path;
}

async function getMemorySnapshot(input = {}) {
  try {
    const path = input.includeInactive === true
      ? "/api/ai/agent/memory?includeInactive=true"
      : "/api/ai/agent/memory";
    const response = await http.get(withEnvQuery(path), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "MEMORY_SNAPSHOT_FAILED");
      return { success: false, items: [], episodes: [], error: mapped.error, code: mapped.code };
    }
    return {
      success: true,
      snapshot: response,
      revision: response.revision,
      policy: response.policy || {},
      items: Array.isArray(response.items) ? response.items : [],
      episodes: Array.isArray(response.episodes) ? response.episodes : [],
      audit: Array.isArray(response.audit) ? response.audit : [],
    };
  } catch (error) {
    const mapped = mapError(error, "MEMORY_SNAPSHOT_FAILED");
    return { success: false, items: [], episodes: [], error: mapped.error, code: mapped.code };
  }
}

async function listMemoryItems(input = {}) {
  try {
    const response = await http.get(withEnvQuery(pageQuery("/api/ai/agent/memory/items", input)), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "LIST_MEMORY_ITEMS_FAILED");
      return { success: false, items: [], error: mapped.error, code: mapped.code };
    }
    return {
      success: true,
      items: Array.isArray(response.items) ? response.items : [],
      revision: response.revision,
      policy: response.policy || null,
      page: response.page,
      pageSize: response.pageSize,
      total: Number(response.total || 0),
    };
  } catch (error) {
    const mapped = mapError(error, "LIST_MEMORY_ITEMS_FAILED");
    return { success: false, items: [], error: mapped.error, code: mapped.code };
  }
}

async function patchMemoryItem(memoryId, patch = {}, expectedRevision) {
  const id = encodeURIComponent(safeText(memoryId, 100));
  if (!id) return { success: false, code: "MEMORY_ID_REQUIRED", error: "请选择要修改的记忆" };
  const body = revisionBody(expectedRevision);
  if (patch.content !== undefined) body.content = safeText(patch.content, 240);
  if (patch.normalizedValue !== undefined) body.normalizedValue = patch.normalizedValue;
  try {
    const response = await http.request(
      withEnvQuery(`/api/ai/agent/memory/items/${id}`),
      "PATCH",
      body,
      requestOptions()
    );
    if (!response || response.success === false) {
      return failureResult(response, "PATCH_MEMORY_ITEM_FAILED");
    }
    return { success: true, memory: response.memory || null, revision: response.revision };
  } catch (error) {
    return failureResult(error, "PATCH_MEMORY_ITEM_FAILED");
  }
}

async function deleteMemoryItem(memoryId, expectedRevision) {
  const id = encodeURIComponent(safeText(memoryId, 100));
  if (!id) return { success: false, code: "MEMORY_ID_REQUIRED", error: "请选择要删除的记忆" };
  try {
    const response = await http.request(
      withEnvQuery(`/api/ai/agent/memory/items/${id}`),
      "DELETE",
      revisionBody(expectedRevision),
      requestOptions()
    );
    if (!response || response.success === false) {
      return failureResult(response, "DELETE_MEMORY_ITEM_FAILED");
    }
    return { success: true, deleted: response.deleted === true, revision: response.revision };
  } catch (error) {
    return failureResult(error, "DELETE_MEMORY_ITEM_FAILED");
  }
}

async function listMemoryEpisodes(input = {}) {
  try {
    const response = await http.get(withEnvQuery(pageQuery("/api/ai/agent/memory/episodes", input)), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "LIST_MEMORY_EPISODES_FAILED");
      return { success: false, items: [], error: mapped.error, code: mapped.code };
    }
    return {
      success: true,
      items: Array.isArray(response.items) ? response.items : [],
      revision: response.revision,
      page: response.page,
      pageSize: response.pageSize,
      total: Number(response.total || 0),
    };
  } catch (error) {
    const mapped = mapError(error, "LIST_MEMORY_EPISODES_FAILED");
    return { success: false, items: [], error: mapped.error, code: mapped.code };
  }
}

async function deleteMemoryEpisode(episodeId, expectedRevision) {
  const id = encodeURIComponent(safeText(episodeId, 100));
  if (!id) return { success: false, code: "EPISODE_ID_REQUIRED", error: "请选择要删除的任务记忆" };
  try {
    const response = await http.request(
      withEnvQuery(`/api/ai/agent/memory/episodes/${id}`),
      "DELETE",
      revisionBody(expectedRevision),
      requestOptions()
    );
    if (!response || response.success === false) {
      return failureResult(response, "DELETE_MEMORY_EPISODE_FAILED");
    }
    return { success: true, deleted: response.deleted === true, revision: response.revision };
  } catch (error) {
    return failureResult(error, "DELETE_MEMORY_EPISODE_FAILED");
  }
}

async function getMemoryPolicy() {
  try {
    const response = await http.get(withEnvQuery("/api/ai/agent/memory/policy"), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "GET_MEMORY_POLICY_FAILED");
      return { success: false, policy: null, error: mapped.error, code: mapped.code };
    }
    return { success: true, policy: response.policy || {}, revision: response.revision };
  } catch (error) {
    const mapped = mapError(error, "GET_MEMORY_POLICY_FAILED");
    return { success: false, policy: null, error: mapped.error, code: mapped.code };
  }
}

async function patchMemoryPolicy(patch = {}, expectedRevision) {
  const body = revisionBody(expectedRevision);
  ["autoMemoryEnabled", "paused", "capacity", "episodeCapacity", "configVersion"].forEach((key) => {
    if (patch[key] !== undefined) body[key] = patch[key];
  });
  try {
    const response = await http.request(
      withEnvQuery("/api/ai/agent/memory/policy"),
      "PATCH",
      body,
      requestOptions()
    );
    if (!response || response.success === false) {
      return failureResult(response, "PATCH_MEMORY_POLICY_FAILED", { policy: null });
    }
    return { success: true, policy: response.policy || {}, revision: response.revision };
  } catch (error) {
    return failureResult(error, "PATCH_MEMORY_POLICY_FAILED", { policy: null });
  }
}

async function exportCloudMemory() {
  try {
    const response = await http.get(withEnvQuery("/api/ai/agent/memory/export"), {}, requestOptions({ timeout: 15000 }));
    if (!response || response.success === false) {
      const mapped = mapError(response, "EXPORT_MEMORY_FAILED");
      return { success: false, export: null, error: mapped.error, code: mapped.code };
    }
    return { success: true, export: response.export || null };
  } catch (error) {
    const mapped = mapError(error, "EXPORT_MEMORY_FAILED");
    return { success: false, export: null, error: mapped.error, code: mapped.code };
  }
}

async function clearCloudMemory(expectedRevision) {
  try {
    const response = await http.request(
      withEnvQuery("/api/ai/agent/memory"),
      "DELETE",
      revisionBody(expectedRevision),
      requestOptions({ timeout: 15000 })
    );
    if (!response || response.success === false) {
      return failureResult(response, "CLEAR_FAILED", {
        partial: Boolean(response && response.partial === true),
        stores: response && response.stores || null,
        revision: response && response.revision,
      });
    }
    return {
      success: true,
      cleared: response.cleared === true,
      partial: response.partial === true,
      stores: response.stores || null,
      revision: response.revision,
      memory: response.memory || null,
    };
  } catch (error) {
    return failureResult(error, "CLEAR_FAILED");
  }
}

function snapshotHasTarget(snapshot, intent) {
  const targetId = safeText(intent && intent.targetId, 100);
  if (!targetId) return true;
  if (!snapshot || typeof snapshot !== "object") return true;
  if (intent.kind === "episode") {
    const episodes = Array.isArray(snapshot.episodes) ? snapshot.episodes : [];
    return episodes.some((item) => safeText(item && (item.episodeId || item.id), 100) === targetId);
  }
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    return safeText(item.memoryId || item.id, 100) === targetId
      || safeText(item.key, 48) === targetId;
  });
}

/**
 * 404 收敛（M5 / Low#2）：delete 目标已不存在视为达到终态（不重试 DELETE）；
 * edit 目标被删不强制覆盖，提示用户重新确认。
 */
function finalizeWriteResult(result, intent, refreshed) {
  if (!isNotFoundResult(result)) return result;
  if (intent.type === "delete") {
    return {
      success: true,
      alreadyGone: true,
      converged: true,
      refreshed: refreshed === true,
      revision: result.revision,
    };
  }
  return Object.assign({}, result, {
    notFound: true,
    error: MEMORY_TARGET_GONE_MESSAGE,
  });
}

/**
 * refresh-on-conflict（H1/M5 通用 seam）：以调用方持有的 revision 执行一次记忆写
 * 操作；仅当结果为 409 revision 冲突时，先刷新云端记忆状态与 revision，再基于不可变
 * 用户意图原样重放一次。第二次仍 409 即停止并给出中文可理解错误；刷新失败不继续写；
 * 非 409 错误（400/401/403/404/5xx/网络）不自动重试；绝不降级为无 revision 写入。
 * 差异回放：delete 目标在刷新后已不存在按 404 收敛；edit 目标被删不强制覆盖；
 * pause 由调用方传入期望终态（绝对值 patch），重放即按终态重应用而非 toggle；
 * clear-all 与 export 语义见 H1（export 为只读，不应经过本 helper）。
 *
 * @param {(expectedRevision, intent) => Promise<object>} operation 真实写操作
 * @param {{type: "clear"|"delete"|"edit"|"pause", kind?: string, targetId?: string, expectedRevision?: number}} userIntent
 */
async function withMemoryRevisionRetry(operation, userIntent = {}) {
  if (typeof operation !== "function") {
    return { success: false, code: "MEMORY_OPERATION_INVALID", error: "记忆操作不可用" };
  }
  const intent = Object.assign({}, userIntent);
  const first = await operation(intent.expectedRevision, intent);
  if (!isRevisionConflictResult(first)) {
    return finalizeWriteResult(first, intent, false);
  }
  // 经 exports 调用刷新，保持与本模块其余 API 一致的 mock/替换语义
  const refreshed = await module.exports.getMemorySnapshot();
  if (!refreshed || refreshed.success === false) {
    return {
      success: false,
      code: first.code,
      statusCode: first.statusCode,
      reasonCode: first.reasonCode,
      refreshed: false,
      refreshFailed: true,
      error: (refreshed && refreshed.error) || MEMORY_REFRESH_FAILED_MESSAGE,
    };
  }
  if ((intent.type === "delete" || intent.type === "edit") && !snapshotHasTarget(refreshed, intent)) {
    if (intent.type === "delete") {
      return {
        success: true,
        alreadyGone: true,
        converged: true,
        refreshed: true,
        revision: refreshed.revision,
      };
    }
    return {
      success: false,
      code: "MEMORY_NOT_FOUND",
      notFound: true,
      refreshed: true,
      revision: refreshed.revision,
      error: MEMORY_TARGET_GONE_MESSAGE,
    };
  }
  // 刷新结果必须携带有效 revision，否则按刷新失败处理，
  // 避免以无 revision 形式重放（服务端 requireMemoryRevision 会 400 兜底）。
  if (!Number.isInteger(refreshed.revision) || refreshed.revision < 0) {
    return {
      success: false,
      code: first.code,
      statusCode: first.statusCode,
      reasonCode: first.reasonCode,
      refreshed: false,
      refreshFailed: true,
      error: MEMORY_REFRESH_FAILED_MESSAGE,
    };
  }
  const second = await operation(refreshed.revision, intent);
  if (isRevisionConflictResult(second)) {
    return Object.assign({}, second, {
      refreshed: true,
      conflictExhausted: true,
      error: MEMORY_CONFLICT_MESSAGE,
    });
  }
  return Object.assign({ refreshed: true, refreshedRevision: refreshed.revision }, finalizeWriteResult(second, intent, true));
}

async function listCloudPreferences() {
  try {
    const response = await http.get(withEnvQuery("/api/ai/agent/memory/preferences"), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "LIST_PREFERENCES_FAILED");
      return { success: false, items: [], error: mapped.error, code: mapped.code };
    }
    return {
      success: true,
      items: Array.isArray(response.items) ? response.items : [],
      revision: Number(response.revision || 0) || 0,
    };
  } catch (error) {
    const mapped = mapError(error, "LIST_PREFERENCES_FAILED");
    return { success: false, items: [], error: mapped.error, code: mapped.code };
  }
}

async function deleteCloudPreference(key, options = {}) {
  const safeKey = safeText(key, 48);
  if (!safeKey) return { success: false, code: "PREFERENCE_KEY_REQUIRED", error: "请选择要删除的记忆" };
  const expectedRevision = Number(
    typeof options === "number" ? options : options.expectedRevision
  );
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return { success: false, code: "MEMORY_REVISION_REQUIRED", error: "记忆版本已过期，请刷新后重试" };
  }
  try {
    const response = await http.request(
      withEnvQuery(`/api/ai/agent/memory/preferences/${encodeURIComponent(safeKey)}`),
      "DELETE",
      { expectedRevision },
      requestOptions()
    );
    if (!response || response.success === false) {
      return failureResult(response, "DELETE_PREFERENCE_FAILED");
    }
    return {
      success: true,
      deleted: response.deleted === true,
      revision: Number(response.revision || 0) || 0,
    };
  } catch (error) {
    return failureResult(error, "DELETE_PREFERENCE_FAILED");
  }
}

async function patchCloudPreference(input = {}) {
  const body = {};
  if (input.values && typeof input.values === "object") body.values = input.values;
  if (input.key) {
    body.key = safeText(input.key, 48);
    body.value = input.value;
  }
  if (typeof input.autoMemoryEnabled === "boolean") body.autoMemoryEnabled = input.autoMemoryEnabled;
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return { success: false, code: "MEMORY_REVISION_REQUIRED", error: "记忆版本已过期，请刷新后重试" };
  }
  body.expectedRevision = expectedRevision;
  try {
    const response = await http.request(
      withEnvQuery("/api/ai/agent/memory/preferences"),
      "PATCH",
      body,
      requestOptions()
    );
    if (!response || response.success === false) {
      return failureResult(response, "PATCH_PREFERENCE_FAILED");
    }
    return {
      success: true,
      persisted: response.persisted === true,
      keys: response.keys || [],
      autoMemoryEnabled: response.autoMemoryEnabled,
      revision: Number(response.revision || 0) || 0,
    };
  } catch (error) {
    return failureResult(error, "PATCH_PREFERENCE_FAILED");
  }
}

/**
 * Server-side proactive evaluate — no model call; at most one suggestion.
 */
async function evaluateProactive(input = {}) {
  const event = safeText(input.event, 64);
  if (!event) return { success: false, proactiveSuggestion: null, code: "EVENT_REQUIRED" };
  try {
    const response = await http.post(withEnvQuery("/api/ai/agent/proactive/evaluate"), {
      event,
      context: input.context && typeof input.context === "object" ? input.context : {},
      facts: input.facts && typeof input.facts === "object" ? input.facts : {},
      conversationId: safeText(input.conversationId, 96),
      memoryMode: safeText(input.memoryMode, 32),
    }, requestOptions({ timeout: 8000, retries: 0 }));
    if (!response || response.success === false) {
      return { success: false, proactiveSuggestion: null, reason: response && response.reason || "failed" };
    }
    return {
      success: true,
      proactiveSuggestion: response.proactiveSuggestion || null,
      reason: response.reason || "",
      event: response.event || event,
    };
  } catch (error) {
    return { success: false, proactiveSuggestion: null, reason: "network" };
  }
}

function toTime(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function sourceBadge(source, memoryMode, conflict) {
  if (conflict) return "冲突";
  if (source === "cloud" || memoryMode === "cloud_sync") return "已同步";
  if (memoryMode === "session_state" || source === "session") return "会话状态";
  if (source === "merged") {
    if (memoryMode === "cloud_sync") return "已同步";
    if (memoryMode === "session_state") return "会话状态";
  }
  return "本机";
}

/**
 * Merge local conversationStore items with cloud list.
 * Higher revision wins; equal revision uses later updatedAt;
 * same revision+time across sources marks conflict without silent overwrite.
 */
function mergeLocalAndCloudConversations(localList = [], cloudList = [], activeConversationId = "") {
  const map = new Map();

  function upsert(item, source) {
    if (!item || !item.conversationId) return;
    const id = String(item.conversationId);
    const memoryMode = safeText(item.memoryMode || item.mode || "local_only", 32) || "local_only";
    const next = {
      conversationId: id,
      title: safeText(item.title || "未命名对话", 80) || "未命名对话",
      messageCount: Math.max(0, Number(item.messageCount || (item.messages && item.messages.length) || 0) || 0),
      updatedAt: item.updatedAt || item.updated_at || "",
      createdAt: item.createdAt || "",
      revision: Math.max(0, Number(item.revision || 0) || 0),
      memoryMode,
      lastTaskType: safeText(item.lastTaskType || item.lastIntent || "", 40),
      source,
      conflict: false,
      active: id === activeConversationId,
      sourceBadge: sourceBadge(source, memoryMode, false),
    };
    const prev = map.get(id);
    if (!prev) {
      map.set(id, next);
      return;
    }
    const preferNext = next.revision > prev.revision
      || (next.revision === prev.revision && toTime(next.updatedAt) > toTime(prev.updatedAt));
    const preferPrev = next.revision < prev.revision
      || (next.revision === prev.revision && toTime(next.updatedAt) < toTime(prev.updatedAt));
    if (preferNext) {
      const conflict = next.revision === prev.revision && toTime(next.updatedAt) === toTime(prev.updatedAt) && prev.source !== next.source;
      map.set(id, Object.assign({}, next, {
        source: "merged",
        conflict,
        messageCount: Math.max(next.messageCount, prev.messageCount),
        title: next.title || prev.title,
        sourceBadge: sourceBadge("merged", next.memoryMode || prev.memoryMode, conflict),
      }));
      return;
    }
    if (preferPrev) {
      map.set(id, Object.assign({}, prev, {
        source: "merged",
        messageCount: Math.max(next.messageCount, prev.messageCount),
        sourceBadge: sourceBadge("merged", prev.memoryMode, false),
      }));
      return;
    }
    map.set(id, Object.assign({}, prev, {
      source: "merged",
      conflict: prev.source !== next.source,
      messageCount: Math.max(next.messageCount, prev.messageCount),
      title: prev.title || next.title,
      sourceBadge: sourceBadge("merged", prev.memoryMode, prev.source !== next.source),
    }));
  }

  (Array.isArray(localList) ? localList : []).forEach((item) => upsert(item, "local"));
  (Array.isArray(cloudList) ? cloudList : []).forEach((item) => upsert(item, "cloud"));

  return Array.from(map.values()).sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
}

module.exports = {
  clearCloudMemory,
  deleteCloudPreference,
  deleteCloudConversation,
  deleteMemoryEpisode,
  deleteMemoryItem,
  evaluateProactive,
  exportCloudMemory,
  getCloudConversation,
  getEnvVersion: platform.getMiniProgramEnvVersion,
  getMemoryPolicy,
  getMemorySnapshot,
  isNotFoundResult,
  isRevisionConflictResult,
  listCloudConversations,
  listCloudPreferences,
  listMemoryEpisodes,
  listMemoryItems,
  mergeLocalAndCloudConversations,
  normalizeRecentTurns,
  patchCloudConversation,
  patchCloudPreference,
  patchMemoryItem,
  patchMemoryPolicy,
  renameCloudConversation,
  sourceBadge,
  updateMemoryPolicy,
  withMemoryRevisionRetry,
};
