/**
 * Detect explicit personal-memory commands and name questions.
 * Does NOT write preferences itself — returns Memory Candidates / preferencePatch
 * for MemoryController.commit (sole durable write path).
 */

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
 * when the user has enabled cloud_sync (functional authorization for User Memory).
 * session_state keeps session_fact for working/thread only (no User Memory).
 */
function parsePersonalMemoryCommands(message, options = {}) {
  const text = safetyGuard.redactSensitiveText(String(message || "")).trim();
  if (!text || safetyGuard.hasSensitiveCredential(String(message || ""))) return [];
  const memoryMode = options.memoryMode || "local_only";
  if (isNameQuestion(text) || identityQuestionKeys(text).length) return [];
  const explicit = /(?:请|帮我)?(?:记住|记一下|以后叫我|以后称呼我)/.test(text);
  const reminderPref = /(?:设置|设定|改成|改为|调整)?\s*(?:默认)?\s*(?:提醒时间|上课提醒|课程提醒)/.test(text)
    || /默认\s*(?:提前|上课前)\s*\d{1,3}\s*分钟/.test(text)
    || /(?:提醒我|提醒时间)\s*(?:改成|改为|设置成|设为)?\s*(?:提前)?\s*\d{1,3}\s*分钟/.test(text)
    || /以后上课前\s*\d{1,3}\s*分钟/.test(text);

  if (!explicit && !reminderPref
    && !/我叫|我的名字|常用|校区|提醒|优先|以后主要|不对|纠正|仙溪|江湾|默认提前|上课前|学院|专业|年级|就读|主修|大[一二三四五六]|20\d{2}级/.test(text)) {
    return [];
  }

  const candidates = filterAndMergeCandidates(extractFromMessage(text), {
    memoryMode,
    autoMemoryEnabled: options.autoMemoryEnabled !== false,
  });

  const output = [];
  // local_only 降级为 working 的身份键仍可作为 session_fact 应答（与 local_only 话术分支设计一致）；
  // 其他 working 候选（提醒、楼栋、班级等）维持原路径，不改变 local_only 既有行为。
  const WORKING_IDENTITY_KEYS = ["preferredName", "college", "major", "grade"];
  candidates.forEach((c) => {
    if (c.reasonCode === "one_off_study_spot") return;
    if (c.scope === "working" && !WORKING_IDENTITY_KEYS.includes(c.key)) return;
    // Durable User Memory only under cloud_sync (or explicit under cloud_sync).
    const canPersistUser = (explicit || mayAutoPersistUserMemory(memoryMode, c)
      || (reminderPref && c.key === "defaultReminderLeadMinutes"))
      && memoryMode === "cloud_sync";
    const item = command(
      c.key,
      c.value,
      canPersistUser,
      canPersistUser ? "preference" : "session_fact"
    );
    if (item) output.push(item);
  });

  // Fallback legacy name parse if extractor missed
  if (!output.some((item) => item.key === "preferredName")) {
    const nameMatch = explicit
      ? text.match(/(?:记住(?:我)?(?:的名字)?(?:是|叫)|以后(?:叫我|称呼我))\s*([\u3400-\u9fffA-Za-z0-9·\-\s]{1,24})/)
      : text.match(/^(?:我的名字(?:是|叫)|我叫)\s*([\u3400-\u9fffA-Za-z0-9·\-\s]{1,24})[，。！？,.!?]?$/);
    if (nameMatch) {
      const value = String(nameMatch[1] || "")
        .replace(/(?:，|,).*/, "")
        .replace(/[。！？.!?~～\s]+$/, "")
        .trim();
      // 纯语气词不是名字（如“记住我哦”的“哦”）。
      if (value && !/^(?:哦|啊|呀|吧|呢|了|嘛|吗|哈|呐|咯|喔)+$/.test(value)) {
        const persist = memoryMode === "cloud_sync";
        const item = command("preferredName", value, persist, persist ? "preference" : "session_fact");
        if (item) output.push(item);
      }
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
    // 只读查找直接走确定性抽取器：parsePersonalMemoryCommands 在 local_only 下会把
    // user 级候选降级为 working 再被过滤，导致回退正则误抓“记住我哦”的“哦”。
    const hit = extractFromMessage(String(item.content || item.text || ""))
      .find((entry) => entry && entry.key === "preferredName" && entry.value);
    if (hit) return String(hit.value).trim();
  }
  return "";
}

// 通用最近事实查找：从对话历史逆向提取指定 key（college/major/grade 等）。
function findRecentFact(messages, key) {
  if (key === "preferredName") return findRecentName(messages);
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index] || {};
    if (item.role !== "user") continue;
    const hit = extractFromMessage(String(item.content || item.text || ""))
      .find((entry) => entry && entry.key === key && entry.value);
    if (hit) return String(hit.value).trim();
  }
  return "";
}

// 身份事实问句识别："我是什么学院的？/ 我读什么专业？/ 我大几？"
// 命中时不得再按陈述句抽取记忆（防止"什么学院"被当成学院名记住）。
function identityQuestionKeys(message) {
  const text = String(message || "").replace(/\s+/g, "");
  const keys = [];
  if (/(?:我是|我在|我读)(?:什么|啥|哪个|哪所)(?:大学)?学院/.test(text)
    || /我的学院是(?:什么|啥|哪个)|你(?:还)?记得我(?:是什么|哪个|啥)(?:大学)?学院/.test(text)) {
    keys.push("college");
  }
  if (/(?:我读|我学|我是)(?:什么|啥|哪个)专业|我的专业是(?:什么|啥|哪个)|你(?:还)?记得我(?:的)?专业/.test(text)) {
    keys.push("major");
  }
  if (/我(?:是|读|现在)?大几|我(?:是|读|现在)?几年级|我(?:是|读|现在)?哪个年级|你(?:还)?记得我大几|(?:^|[？?，。！？、,.!?])\s*大几|(?:^|[？?，。！？、,.!?])\s*(?:读|上|念)?几年级/.test(text)) {
    keys.push("grade");
  }
  return keys;
}

function toMemoryCandidates(commands, memoryMode) {
  return (Array.isArray(commands) ? commands : []).map((item) => ({
    type: "preference",
    key: item.key,
    value: item.value,
    scope: item.persist && memoryMode === "cloud_sync" ? "user" : "working",
    confidence: 0.95,
    reasonCode: "interpreter_command",
    source: "explicit_user",
    correction: false,
  }));
}

/**
 * Resolve personal memory turn. Never writes UserPreferenceService directly.
 * Durable persistence is MemoryController.commit via preferencePatch / memoryCandidates.
 */
function resolvePersonalMemoryTurn(input = {}) {
  const message = String(input.message || "").trim();
  const context = input.context && typeof input.context === "object" ? input.context : {};
  const memoryMode = input.memoryMode || context.memoryMode || "local_only";
  const autoMemoryEnabled = input.autoMemoryEnabled !== false;
  const commands = parsePersonalMemoryCommands(message, {
    memoryMode,
    autoMemoryEnabled,
  });
  const preferencePatch = {};
  commands.filter((item) => item.persist).forEach((item) => {
    preferencePatch[item.key] = item.value;
  });
  const sessionFacts = {};
  commands.forEach((item) => {
    if (!item.persist) sessionFacts[item.key] = item.value;
  });
  // Working-scope names also flow as preferredName for MemoryController working memory.
  if (sessionFacts.preferredName && !preferencePatch.preferredName) {
    // Keep in sessionFacts only; MemoryController applies to working memory.
  }

  if (commands.length) {
    const willPersistUser = Object.keys(preferencePatch).length > 0 && memoryMode === "cloud_sync" && autoMemoryEnabled;
    if (Object.keys(preferencePatch).length || Object.keys(sessionFacts).length) {
      const labels = [];
      const all = Object.assign({}, sessionFacts, preferencePatch);
      if (all.preferredName) labels.push(`称呼“${all.preferredName}”`);
      if (all.campus) labels.push(`常用校区“${all.campus}”`);
      if (all.college) labels.push(`学院“${all.college}”`);
      if (all.major) labels.push(`专业“${all.major}”`);
      if (all.grade) labels.push(`年级“${all.grade}”`);
      if (all.defaultReminderLeadMinutes) {
        labels.push(`默认提前 ${all.defaultReminderLeadMinutes} 分钟提醒`);
      }
      if (all.preferredBuilding) labels.push(`常用楼栋“${all.preferredBuilding}”`);
      if (all.answerDetailLevel) labels.push(`回答偏好“${all.answerDetailLevel}”`);

      let answer;
      if (willPersistUser) {
        answer = `已记住${labels.join("、")}，并保存到你的记忆（可在记忆设置中修改）。`;
      } else if (memoryMode === "session_state") {
        answer = `好的，这次对话里我知道${labels.join("、")}。开启「跨设备同步」后可跨对话保留称呼等偏好。`;
      } else if (memoryMode === "local_only") {
        answer = `好的，这次对话里我知道${labels.join("、")}。开启「保存任务状态」或「跨设备同步」后可自动保留。`;
      } else {
        answer = `已记住${labels.join("、")}。`;
      }

      return {
        handled: true,
        intentName: "update_user_preference",
        answer,
        preferencePatch: willPersistUser ? preferencePatch : {},
        sessionFacts: Object.assign({}, sessionFacts, willPersistUser ? {} : preferencePatch),
        memoryCandidates: toMemoryCandidates(commands, memoryMode),
        // Never claim server-persisted here — MemoryController is the sole writer.
        persisted: false,
        willPersistUser,
        source: willPersistUser ? "pending_memory_controller" : "session_fact",
        autoMemoryHint: willPersistUser && preferencePatch.campus
          ? "已记住你的常用校区，可在记忆设置中修改。"
          : (willPersistUser && preferencePatch.preferredName
            ? "已记住你的称呼，可在记忆设置中修改。"
            : ""),
      };
    }
  }

  // Auto-apply a sensible default (20 min) when user asks to set default reminder time without a number.
  if (/(?:设置|设定|调整)?\s*(?:默认)?\s*(?:提醒时间|上课提醒|课程提醒)/.test(message)
    && !/\d{1,3}\s*分钟/.test(message)
    && !/(?:取消|删除|关闭|暂停).*(?:提醒|通知)/.test(message)) {
    const defaultLead = 20;
    const willPersistUser = memoryMode === "cloud_sync" && autoMemoryEnabled;
    return {
      handled: true,
      intentName: "update_user_preference",
      answer: willPersistUser
        ? `已把默认提醒时间设为上课前 ${defaultLead} 分钟，并保存到记忆。可以说“以后上课前${defaultLead}分钟提醒我”直接创建，或点下方按钮一键创建并授权微信服务通知。`
        : `已把默认提醒时间设为上课前 ${defaultLead} 分钟。可以说“以后上课前${defaultLead}分钟提醒我”直接创建，或点下方按钮一键创建并授权微信服务通知。想改成 30/45/60 分钟直接告诉我即可。`,
      preferencePatch: willPersistUser ? { defaultReminderLeadMinutes: defaultLead } : {},
      sessionFacts: willPersistUser ? {} : { defaultReminderLeadMinutes: defaultLead },
      memoryCandidates: toMemoryCandidates([
        command("defaultReminderLeadMinutes", defaultLead, willPersistUser, willPersistUser ? "preference" : "session_fact"),
      ].filter(Boolean), memoryMode),
      persisted: false,
      willPersistUser,
      source: willPersistUser ? "pending_memory_controller" : "session_fact",
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

  if (!isNameQuestion(message)) {
    const identityKeys = identityQuestionKeys(message);
    if (!identityKeys.length) return { handled: false };
    return resolveIdentityQuestionTurn({
      message,
      context,
      memoryMode,
      principal: input.principal,
      preferenceService: input.preferenceService,
    }, identityKeys);
  }

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
  // Cross-conversation User Memory only for cloud_sync
  if (!preferredName && memoryMode === "cloud_sync" && input.preferenceService) {
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
      : "我还不知道你的名字。你可以说“我的名字叫……”，开启跨设备同步后会自动记住称呼。",
    preferencePatch: {},
    sessionFacts: {},
    memoryCandidates: [],
    persisted: false,
    source: source || "none",
  };
}

const IDENTITY_LABELS = { college: "学院", major: "专业", grade: "年级" };

// 身份事实问句应答："我是什么学院的？大几？" → 从偏好/工作记忆/对话历史/云端记忆作答。
// 解析顺序与名字问句一致：context.userPreferences → workingMemory → recentMessages → cloud。
function resolveIdentityQuestionTurn(input = {}, keys = []) {
  const context = input.context && typeof input.context === "object" ? input.context : {};
  const memoryMode = input.memoryMode || context.memoryMode || "local_only";
  const contextPreferences = context.userPreferences && typeof context.userPreferences === "object"
    ? context.userPreferences
    : {};
  let cloudValues = {};
  if (memoryMode === "cloud_sync" && input.preferenceService) {
    try {
      cloudValues = input.preferenceService.getObject({ principal: input.principal }) || {};
    } catch (_) {
      cloudValues = {};
    }
  }
  const found = [];
  const missing = [];
  keys.forEach((key) => {
    let value = normalizeValue(key, contextPreferences[key]) || "";
    if (!value && context.workingMemory && context.workingMemory[key]) {
      value = normalizeValue(key, context.workingMemory[key]) || "";
    }
    if (!value) value = normalizeValue(key, findRecentFact(context.recentMessages, key)) || "";
    if (!value) value = normalizeValue(key, cloudValues[key]) || "";
    if (value) found.push({ key, value });
    else missing.push(key);
  });

  let answer;
  if (found.length) {
    const parts = found.map((item) => (item.key === "college" ? `学院是${item.value}`
      : item.key === "major" ? `专业是${item.value}` : `年级是${item.value}`));
    answer = `你${parts.join("，")}。`;
    if (missing.length) {
      answer += `还不知道你的${missing.map((k) => IDENTITY_LABELS[k]).join("和")}，告诉我就记住啦。`;
    }
  } else {
    const asked = keys.map((k) => IDENTITY_LABELS[k]).join("和");
    answer = `我还不知道你的${asked}。你可以直接告诉我，比如“我是……学院的大二学生”，开启跨设备同步后会自动记住。`;
  }
  return {
    handled: true,
    intentName: "conversation_memory",
    answer,
    preferencePatch: {},
    sessionFacts: {},
    memoryCandidates: [],
    persisted: false,
    source: found.length ? "identity_memory" : "none",
  };
}

module.exports = {
  findRecentName,
  findRecentFact,
  identityQuestionKeys,
  isNameQuestion,
  parsePersonalMemoryCommand,
  parsePersonalMemoryCommands,
  resolveIdentityQuestionTurn,
  resolvePersonalMemoryTurn,
  toMemoryCandidates,
};
