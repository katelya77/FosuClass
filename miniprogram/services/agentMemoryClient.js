/**
 * Cloud memory client for 小佛助手.
 * Uses existing request + session headers; never stores OpenID.
 */
const http = require("../utils/request");
const agentClientErrorMapper = require("./agentClientErrorMapper");

function safeText(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return String(info && info.miniProgram && info.miniProgram.envVersion || "release");
  } catch (error) {
    return "release";
  }
}

function withEnvQuery(path) {
  const envVersion = encodeURIComponent(getEnvVersion());
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

async function listCloudConversations() {
  try {
    const response = await http.get(withEnvQuery("/api/ai/agent/conversations"), {}, requestOptions());
    if (!response || response.success === false) {
      const mapped = mapError(response, "LIST_FAILED");
      return { success: false, conversations: [], error: mapped.error, code: mapped.code };
    }
    const conversations = Array.isArray(response.conversations)
      ? response.conversations
      : (Array.isArray(response.data) ? response.data : []);
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
    return { success: true, conversation: response.conversation || response.data || null };
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

async function clearCloudMemory() {
  try {
    const response = await http.request(withEnvQuery("/api/ai/agent/memory"), "DELETE", {}, requestOptions({ timeout: 15000 }));
    if (!response || response.success === false) {
      const mapped = mapError(response, "CLEAR_FAILED");
      return { success: false, error: mapped.error, code: mapped.code };
    }
    return { success: true, cleared: true, memory: response.memory || null };
  } catch (error) {
    const mapped = mapError(error, "CLEAR_FAILED");
    return { success: false, error: mapped.error, code: mapped.code };
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
  deleteCloudConversation,
  getCloudConversation,
  getEnvVersion,
  listCloudConversations,
  mergeLocalAndCloudConversations,
  patchCloudConversation,
  renameCloudConversation,
  sourceBadge,
  updateMemoryPolicy,
};
