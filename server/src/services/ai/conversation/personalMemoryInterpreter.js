const safetyGuard = require("../safetyGuard");
const { normalizeValue } = require("./userPreferenceService");
const { extractFromMessage } = require("../memory/memoryCandidateExtractor");
const { mayAutoPersistUserMemory, filterAndMergeCandidates } = require("../memory/memoryPolicy");

function command(key, value, persist, kind) {
  const normalized = normalizeValue(key, value);
  if (normalized === null && key !== "preferPersonalSchedule") return null;
  return {
    kind: kind || (persist ? "preference" : "session_fact"),
    key,
    value: normalized !== null ? normalized : value,
    persist: persist === true,
  };
}

/**
 * Parse personal memory statements.
 * Low-risk facts (name, campus, reminder) no longer require the keyword “记住”
 * when the user has enabled session_state / cloud_sync (functional authorization).
 */
function parsePersonalMemoryCommands(message, options = {}) {
  const text = safetyGuard.redactSensitiveText(String(message || "")).trim();
  if (!text || safetyGuard.hasSensitiveCredential(String(message || ""))) return [];
  const memoryMode = options.memoryMode || "local_only";
  // Pure name questions never create preference commands.
  if (isNameQuestion(text)) return [];
  const explicit = /(?:请|帮我)?(?:记住|记一下|以后叫我|以后称呼我)/.test(text);
  const reminderPref = /(?:设置|设定|改成|改为|调整)?\s*(?:默认)?\s*(?:提醒时间|上课提醒|课程提醒)/.test(text)
    || /默认\s*(?:提前|上课前)\s*\d{1,3}\s*分钟/.test(text)
    || /(?:提醒我|提醒时间)\s*(?:改成|改为|设置成|设为)?\s*(?:提前)?\s*\d{1,3}\s*分钟/.test(text)
    || /以后上课前\s*\d{1,3}\s*分钟/.test(text);

  if (!explicit && !reminderPref
    && !/我叫|我的名字|常用|校区|提醒|优先|以后主要|不对|纠正|仙溪|江湾|默认提前|上课前/.test(text)) {
    return [];
  }

  const candidates = filterAndMergeCandidates(extractFromMessage(text), {
    memoryMode,
    autoMemoryEnabled: options.autoMemoryEnabled !== false,
  });

  const output = [];
  candidates.forEach((c) => {
    if (c.scope === "working" || c.reasonCode === "one_off_study_spot") return;
    const canPersist = explicit
      || mayAutoPersistUserMemory(memoryMode, c)
      || (reminderPref && c.key === "defaultReminderLeadMinutes");
    // session_fact always for same-conversation; durable when authorized
    const item = command(
      c.key,
      c.value,
      canPersist && memoryMode !== "local_only",
      canPersist && memoryMode !== "local_only" ? "preference" : "session_fact"
    );
    if (item) output.push(item);
  });

  // Fallback legacy name parse if extractor missed
  if (!output.some((item) => item.key === "preferredName")) {
    const nameMatch = explicit
      ? text.match(/(?:记住(?:我)?(?:的名字)?(?:是|叫)?|以后(?:叫我|称呼我))\s*([\u3400-\u9fffA-Za-z0-9·\-\s]{1,24})/)
      : text.match(/^(?:我的名字(?:是|叫)|我叫)\s*([\u3400-\u9fffA-Za-z0-9·\-\s]{1,24})[，。！？,.!?]?$/);
    if (nameMatch) {
      const value = String(nameMatch[1] || "").replace(/(?:，|,).*/, "").trim();
      const persist = memoryMode === "session_state" || memoryMode === "cloud_sync" || explicit;
      const item = command("preferredName", value, persist && memoryMode !== "local_only", persist ? "preference" : "session_fact");
      if (item) output.push(item);
    }
  }

  const seen = new Set();
  return output.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function parsePersonalMemoryCommand(message, options = {}) {
  return parsePersonalMemoryCommands(message, options)[0] || null;
}

function isNameQuestion(message) {
  const text = String(message || "").replace(/\s+/g, "");
  return /(?:我叫(?:什么|啥)|我的名字(?:是)?(?:什么|叫啥)|你(?:还)?记得我叫(?:什么|啥)|我刚刚说我叫(?:什么|啥)|我叫什么名字)/.test(text);
}

function findRecentName(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index] || {};
    if (item.role !== "user") continue;
    const parsed = parsePersonalMemoryCommands(item.content || item.text || "", { memoryMode: "local_only" });
    const name = parsed.find((entry) => entry.key === "preferredName");
    if (name) return name.value;
  }
  return "";
}

function resolvePersonalMemoryTurn(input = {}) {
  const message = String(input.message || "").trim();
  const context = input.context && typeof input.context === "object" ? input.context : {};
  const memoryMode = input.memoryMode || context.memoryMode || "local_only";
  const commands = parsePersonalMemoryCommands(message, {
    memoryMode,
    autoMemoryEnabled: input.autoMemoryEnabled !== false,
  });
  const preferencePatch = {};
  commands.filter((item) => item.persist).forEach((item) => {
    preferencePatch[item.key] = item.value;
  });
  // Also keep session-visible name even when local_only (non-durable patch for working memory)
  const sessionFacts = {};
  commands.forEach((item) => {
    if (!item.persist) sessionFacts[item.key] = item.value;
  });

  if (commands.length) {
    let persisted = false;
    if (Object.keys(preferencePatch).length && input.preferenceService) {
      try {
        const saved = input.preferenceService.upsert({
          principal: input.principal,
          memoryMode,
          explicit: true,
          autoMemory: true,
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
      if (preferencePatch.preferredBuilding) labels.push(`常用楼栋“${preferencePatch.preferredBuilding}”`);
      return {
        handled: true,
        intentName: "update_user_preference",
        answer: persisted
          ? `已记住${labels.join("、")}，并保存到你的记忆（可在记忆设置中修改）。`
          : memoryMode === "local_only"
            ? `好的，这次对话里我知道${labels.join("、")}。开启「保存任务状态」或「跨设备同步」后可自动保留。`
            : `已记住${labels.join("、")}。`,
        preferencePatch,
        sessionFacts,
        persisted,
        source: persisted ? "cloud_preference" : "local_preference_patch",
        autoMemoryHint: persisted && preferencePatch.campus
          ? "已记住你的常用校区，可在记忆设置中修改。"
          : (persisted && preferencePatch.preferredName
            ? "已记住你的称呼，可在记忆设置中修改。"
            : ""),
      };
    }
    const sessionName = commands.find((item) => item.key === "preferredName");
    if (sessionName) {
      return {
        handled: true,
        intentName: "conversation_memory",
        answer: `好的，这次对话里我知道你叫${sessionName.value}。`,
        preferencePatch: {},
        sessionFacts: { preferredName: sessionName.value },
        persisted: false,
        source: "recent_messages",
      };
    }
  }

  // Auto-apply a sensible default (20 min) when user asks to set default reminder time without a number.
  if (/(?:设置|设定|调整)?\s*(?:默认)?\s*(?:提醒时间|上课提醒|课程提醒)/.test(message)
    && !/\d{1,3}\s*分钟/.test(message)
    && !/(?:取消|删除|关闭|暂停).*(?:提醒|通知)/.test(message)) {
    const defaultLead = 20;
    let persisted = false;
    if (input.preferenceService && (memoryMode === "session_state" || memoryMode === "cloud_sync")) {
      try {
        const saved = input.preferenceService.upsert({
          principal: input.principal,
          memoryMode,
          explicit: true,
          autoMemory: true,
          values: { defaultReminderLeadMinutes: defaultLead },
        });
        persisted = saved.persisted === true;
      } catch (_) {
        persisted = false;
      }
    }
    return {
      handled: true,
      intentName: "update_user_preference",
      answer: persisted
        ? `已把默认提醒时间设为上课前 ${defaultLead} 分钟，并保存到记忆。可以说“以后上课前${defaultLead}分钟提醒我”直接创建，或点下方按钮一键创建并授权微信服务通知。`
        : `已把默认提醒时间设为上课前 ${defaultLead} 分钟。可以说“以后上课前${defaultLead}分钟提醒我”直接创建，或点下方按钮一键创建并授权微信服务通知。想改成 30/45/60 分钟直接告诉我即可。`,
      preferencePatch: { defaultReminderLeadMinutes: defaultLead },
      persisted,
      source: persisted ? "cloud_preference" : "local_preference_patch",
      actions: [
        {
          label: "一键创建并授权通知",
          type: "confirmReminder",
          payload: { operation: "create", leadMinutes: defaultLead, scope: "all_courses" },
        },
        { label: "默认改成30分钟", type: "retry", payload: { message: "默认提前30分钟提醒我" } },
        { label: "打开提醒面板", type: "manageReminders", payload: { sheet: "reminders", openCreate: true } },
      ],
    };
  }

  if (!isNameQuestion(message)) return { handled: false };

  const contextPreferences = context.userPreferences && typeof context.userPreferences === "object"
    ? context.userPreferences
    : {};
  let preferredName = normalizeValue("preferredName", contextPreferences.preferredName) || "";
  let source = preferredName ? "local_preference" : "";
  if (!preferredName && context.workingMemory && context.workingMemory.preferredName) {
    preferredName = normalizeValue("preferredName", context.workingMemory.preferredName) || "";
    if (preferredName) source = "working_memory";
  }
  if (!preferredName) {
    preferredName = findRecentName(context.recentMessages);
    if (preferredName) source = "recent_messages";
  }
  if (!preferredName && (memoryMode === "cloud_sync" || memoryMode === "session_state") && input.preferenceService) {
    try {
      const cloud = input.preferenceService.getObject({ principal: input.principal });
      preferredName = normalizeValue("preferredName", cloud.preferredName) || "";
      if (preferredName) source = memoryMode === "cloud_sync" ? "cloud_preference" : "session_preference";
    } catch (_) {
      preferredName = "";
    }
  }
  return {
    handled: true,
    intentName: "conversation_memory",
    answer: preferredName
      ? `你叫${preferredName}。`
      : "我还不知道你的名字。你可以说“我的名字叫……”，开启任务状态或跨设备同步后会自动记住称呼。",
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
