const safetyGuard = require("../safetyGuard");
const { normalizeValue } = require("./userPreferenceService");

function command(key, value, persist, kind) {
  const normalized = normalizeValue(key, value);
  if (normalized === null) return null;
  return {
    kind: kind || (persist ? "preference" : "session_fact"),
    key,
    value: normalized,
    persist: persist === true,
  };
}

function parsePersonalMemoryCommands(message) {
  const text = safetyGuard.redactSensitiveText(String(message || "")).trim();
  if (!text || safetyGuard.hasSensitiveCredential(String(message || ""))) return [];
  const explicit = /(?:请|帮我)?(?:记住|记一下|以后叫我|以后称呼我)/.test(text);
  if (!explicit && isNameQuestion(text)) return [];
  const output = [];

  const nameMatch = explicit
    ? text.match(/(?:记住(?:我)?(?:的名字)?(?:是|叫)?|以后(?:叫我|称呼我))\s*([\u3400-\u9fffA-Za-z0-9·\-\s]{1,24})/)
    : text.match(/^(?:我的名字(?:是|叫)|我叫)\s*([\u3400-\u9fffA-Za-z0-9·\-\s]{1,24})[，。！？,.!?]?$/);
  if (nameMatch) {
    const value = String(nameMatch[1] || "").replace(/(?:，|,).*/, "").trim();
    const item = command("preferredName", value, explicit, explicit ? "preference" : "session_fact");
    if (item) output.push(item);
  }

  if (explicit) {
    const campusMatch = text.match(/(?:常用|默认|主要在)?\s*(仙溪校区|江湾校区)/);
    const campusItem = campusMatch && command("campus", campusMatch[1], true, "preference");
    if (campusItem) output.push(campusItem);

    const leadMatch = text.match(/(?:默认)?(?:提前|上课前)\s*(\d{1,3})\s*分钟(?:提醒)?/);
    const leadItem = leadMatch && command("defaultReminderLeadMinutes", Number(leadMatch[1]), true, "preference");
    if (leadItem) output.push(leadItem);
  }

  const seen = new Set();
  return output.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function parsePersonalMemoryCommand(message) {
  return parsePersonalMemoryCommands(message)[0] || null;
}

function isNameQuestion(message) {
  const text = String(message || "").replace(/\s+/g, "");
  return /(?:我叫(?:什么|啥)|我的名字(?:是)?(?:什么|叫啥)|你(?:还)?记得我叫(?:什么|啥))/.test(text);
}

function findRecentName(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index] || {};
    if (item.role !== "user") continue;
    const parsed = parsePersonalMemoryCommands(item.content || item.text || "");
    const name = parsed.find((entry) => entry.key === "preferredName");
    if (name) return name.value;
  }
  return "";
}

function resolvePersonalMemoryTurn(input = {}) {
  const message = String(input.message || "").trim();
  const context = input.context && typeof input.context === "object" ? input.context : {};
  const commands = parsePersonalMemoryCommands(message);
  const preferencePatch = {};
  commands.filter((item) => item.persist).forEach((item) => {
    preferencePatch[item.key] = item.value;
  });

  if (commands.length) {
    let persisted = false;
    if (Object.keys(preferencePatch).length && input.preferenceService) {
      try {
        const saved = input.preferenceService.upsert({
          principal: input.principal,
          memoryMode: input.memoryMode,
          explicit: true,
          values: preferencePatch,
        });
        persisted = saved.persisted === true;
      } catch (_) {
        persisted = false;
      }
    }
    if (Object.keys(preferencePatch).length) {
      const labels = [];
      if (preferencePatch.preferredName) labels.push(`称呼“${preferencePatch.preferredName}”`);
      if (preferencePatch.campus) labels.push(`常用校区“${preferencePatch.campus}”`);
      if (preferencePatch.defaultReminderLeadMinutes) {
        labels.push(`默认提前 ${preferencePatch.defaultReminderLeadMinutes} 分钟提醒`);
      }
      return {
        handled: true,
        intentName: "update_user_preference",
        answer: persisted
          ? `已记住${labels.join("、")}，并同步到你的云端记忆。`
          : `已记住${labels.join("、")}。当前仅保存在本机；开启云端记忆后才能跨设备恢复。`,
        preferencePatch,
        persisted,
        source: persisted ? "cloud_preference" : "local_preference_patch",
      };
    }
    const sessionName = commands.find((item) => item.key === "preferredName");
    return {
      handled: true,
      intentName: "conversation_memory",
      answer: `好的，这次对话里我知道你叫${sessionName.value}。如果要跨会话保留，请明确说“记住我叫${sessionName.value}”。`,
      preferencePatch: {},
      persisted: false,
      source: "recent_messages",
    };
  }

  if (!isNameQuestion(message)) return { handled: false };

  const contextPreferences = context.userPreferences && typeof context.userPreferences === "object"
    ? context.userPreferences
    : {};
  let preferredName = normalizeValue("preferredName", contextPreferences.preferredName) || "";
  let source = preferredName ? "local_preference" : "";
  if (!preferredName) {
    preferredName = findRecentName(context.recentMessages);
    if (preferredName) source = "recent_messages";
  }
  if (!preferredName && input.memoryMode === "cloud_sync" && input.preferenceService) {
    try {
      const cloud = input.preferenceService.getObject({ principal: input.principal });
      preferredName = normalizeValue("preferredName", cloud.preferredName) || "";
      if (preferredName) source = "cloud_preference";
    } catch (_) {
      preferredName = "";
    }
  }
  return {
    handled: true,
    intentName: "conversation_memory",
    answer: preferredName
      ? `你叫${preferredName}。`
      : "我还不知道你的名字。你可以说“我的名字叫……”；只有明确说“记住我叫……”时，我才会把称呼保存为长期偏好。",
    preferencePatch: {},
    persisted: false,
    source: source || "none",
  };
}

module.exports = {
  findRecentName,
  isNameQuestion,
  parsePersonalMemoryCommand,
  parsePersonalMemoryCommands,
  resolvePersonalMemoryTurn,
};
