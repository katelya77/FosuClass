/**
 * Deterministic memory candidate extraction from a successful turn.
 * No extra model call. trial/dev may merge structured candidates from an
 * existing provider payload via extractFromProviderPayload (same turn only).
 */

const safetyGuard = require("../safetyGuard");
const { normalizeValue } = require("../conversation/userPreferenceService");
const { isTemporaryCandidate } = require("./memoryPolicy");

function redact(text) {
  return safetyGuard.redactSensitiveText(String(text || "")).trim();
}

function candidate(partial) {
  return {
    type: partial.type || "preference",
    key: partial.key,
    value: partial.value,
    scope: partial.scope || "user",
    confidence: partial.confidence != null ? partial.confidence : 0.9,
    sourceTurnIds: partial.sourceTurnIds || [],
    expiresAt: partial.expiresAt || null,
    sensitivity: partial.sensitivity || "low",
    reasonCode: partial.reasonCode || "auto_extract",
    correction: partial.correction === true,
    rawText: partial.rawText || "",
    source: partial.source || "deterministic",
  };
}

/**
 * Extract low-risk long-term and working-scoped candidates from user message.
 */
function extractFromMessage(message, options = {}) {
  const text = redact(message);
  if (!text || safetyGuard.hasSensitiveCredential(String(message || ""))) return [];
  if (/(学号|密码|cookie|token|authorization)/i.test(text)) return [];
  // 隐私黑名单：电话/身份证/住址类内容不提取任何记忆候选
  if (/1[3-9]\d{9}/.test(text)) return [];
  if (/\d{17}[\dXx]/.test(text)) return [];
  if (/(家庭住址|家庭地址|收货地址|住在.{1,20}(路|街|号|栋|室))/.test(text)) return [];

  const output = [];
  const turnId = options.turnId || "";
  const isCorrection = /不对|不是|改成|改为|以后主要|以后优先|纠正/.test(text);

  // Preferred name — no longer requires “记住”. Skip pure name questions.
  const isNameQuestion = /(?:我叫(?:什么|啥)|我的名字(?:是)?(?:什么|叫啥)|你(?:还)?记得我叫(?:什么|啥)|我刚刚说我叫(?:什么|啥))/.test(text.replace(/\s+/g, ""));
  if (!isNameQuestion) {
    // 仅匹配明确自称句式：我叫X / 我的名字叫X / 以后叫我X（含"称呼我"变体）
    const nameMatch = text.match(/(?:我的名字叫|我叫|以后(?:叫我|称呼我))\s*([\u3400-\u9fffA-Za-z0-9·\-\s]{1,24})/);
    if (nameMatch) {
      const value = normalizeValue("preferredName", nameMatch[1]);
      // Reject interrogative placeholders mistaken as names
      if (value && !/^(什么|啥|谁|哪|怎么|如何)/.test(value)) {
        output.push(candidate({
          type: "identity",
          key: "preferredName",
          value,
          scope: "user",
          confidence: isCorrection ? 0.98 : 0.92,
          reasonCode: isCorrection ? "user_correction" : "name_statement",
          correction: isCorrection,
          sourceTurnIds: turnId ? [turnId] : [],
          rawText: text.slice(0, 80),
        }));
      }
    }
  }

  // Campus preference (long-term phrasing)
  const campusLong = /(?:常用|默认|主要在|以后.*在|优先)\s*(仙溪校区|江湾校区|仙溪|江湾)/.test(text)
    || (isCorrection && /(仙溪校区|江湾校区|仙溪|江湾)/.test(text));
  if (campusLong) {
    const m = text.match(/(仙溪校区|江湾校区|仙溪|江湾)/);
    if (m) {
      const campus = /江湾/.test(m[1]) ? "江湾校区" : "仙溪校区";
      const value = normalizeValue("campus", campus);
      if (value) {
        output.push(candidate({
          type: "location_pref",
          key: "campus",
          value,
          scope: "user",
          confidence: isCorrection ? 0.98 : 0.9,
          reasonCode: isCorrection ? "user_correction" : "campus_preference",
          correction: isCorrection,
          sourceTurnIds: turnId ? [turnId] : [],
          rawText: text.slice(0, 80),
        }));
      }
    }
  }

  // Preferred building — only with long-term language
  if (/(?:以后|优先|常用|默认).{0,12}(C\d+[A-Za-z]?|教\d+)/.test(text)
    || /优先推荐\s*(C\d+[A-Za-z]?)/.test(text)) {
    const bm = text.match(/(C\d+[A-Za-z]?|教\d+)/);
    if (bm) {
      output.push(candidate({
        type: "location_pref",
        key: "preferredBuilding",
        value: bm[1],
        scope: "user",
        confidence: 0.88,
        reasonCode: "building_preference",
        sourceTurnIds: turnId ? [turnId] : [],
        rawText: text.slice(0, 80),
      }));
    }
  }

  // Temporary study spot — working only
  if (/今天|今天下午|今晚|这次/.test(text) && /(C\d+|自习)/.test(text) && !/以后|优先|常用|默认/.test(text)) {
    const bm = text.match(/(C\d+[A-Za-z]?)/);
    output.push(candidate({
      type: "task_state",
      key: "tempStudySpot",
      value: bm ? bm[1] : "study",
      scope: "working",
      confidence: 0.85,
      reasonCode: "one_off_study_spot",
      sensitivity: "low",
      sourceTurnIds: turnId ? [turnId] : [],
      rawText: text.slice(0, 80),
    }));
  }

  // Reminder lead
  const leadMatch = text.match(/(?:默认)?(?:提前|上课前)\s*(\d{1,3})\s*分钟(?:提醒)?/)
    || text.match(/(?:提醒时间|上课提醒|课程提醒|默认提醒).*?(\d{1,3})\s*分钟/)
    || text.match(/以后上课前\s*(\d{1,3})\s*分钟/);
  if (leadMatch) {
    const value = normalizeValue("defaultReminderLeadMinutes", Number(leadMatch[1]));
    if (value != null) {
      output.push(candidate({
        type: "reminder_pref",
        key: "defaultReminderLeadMinutes",
        value,
        scope: "user",
        confidence: 0.93,
        reasonCode: "reminder_preference",
        sourceTurnIds: turnId ? [turnId] : [],
        rawText: text.slice(0, 80),
      }));
    }
  }

  // Answer detail
  if (/回答(?:详细|简洁|简短)一点|以后(?:详细|简洁)回答/.test(text)) {
    const level = /简洁|简短/.test(text) ? "concise" : "detailed";
    output.push(candidate({
      type: "style_pref",
      key: "answerDetailLevel",
      value: level,
      scope: "user",
      confidence: 0.86,
      reasonCode: "style_preference",
      sourceTurnIds: turnId ? [turnId] : [],
      rawText: text.slice(0, 80),
    }));
  }

  // Prefer personal schedule
  if (/优先(?:用|看)?个人课表|以后优先个人课表/.test(text)) {
    output.push(candidate({
      type: "schedule_pref",
      key: "preferPersonalSchedule",
      value: true,
      scope: "user",
      confidence: 0.88,
      reasonCode: "schedule_preference",
      sourceTurnIds: turnId ? [turnId] : [],
      rawText: text.slice(0, 80),
    }));
  }

  // Frequently queried class (stable phrasing)
  if (/(?:我的班级|默认班级|常用班级)(?:是|：|:)?\s*([\u3400-\u9fff0-9A-Za-z]{2,40}班)/.test(text)) {
    const cm = text.match(/(?:我的班级|默认班级|常用班级)(?:是|：|:)?\s*([\u3400-\u9fff0-9A-Za-z]{2,40}班)/);
    if (cm) {
      output.push(candidate({
        type: "schedule_pref",
        key: "preferredClassName",
        value: cm[1],
        scope: "user",
        confidence: 0.87,
        reasonCode: "class_preference",
        sourceTurnIds: turnId ? [turnId] : [],
        rawText: text.slice(0, 80),
      }));
    }
  }

  // Named relation（类型化关系记忆）：第三方人物信息默认仅进 Working Memory，不进长期 User Memory。
  // 例："我妈妈叫刘秀英" → { relation: "mother", displayRelation: "妈妈", name: "刘秀英" }
  const RELATION_MAP = {
    妈妈: "mother", 母亲: "mother", 老妈: "mother", 妈: "mother",
    爸爸: "father", 父亲: "father", 老爸: "father", 爸: "father",
    姐姐: "sister", 姐: "sister", 妹妹: "sister", 妹: "sister",
    哥哥: "brother", 哥: "brother", 弟弟: "brother", 弟: "brother",
    老婆: "wife", 妻子: "wife", 老公: "husband", 丈夫: "husband",
    儿子: "son", 女儿: "daughter",
    辅导员: "counselor", 班主任: "head_teacher", 导师: "mentor",
    室友: "roommate", 同学: "classmate",
    女朋友: "girlfriend", 男朋友: "boyfriend", 朋友: "friend",
  };
  const relWord = `(妈妈|母亲|老妈|妈|爸爸|父亲|老爸|爸|姐姐|姐|妹妹|妹|哥哥|哥|弟弟|弟|老婆|妻子|老公|丈夫|儿子|女儿|辅导员|班主任|导师|室友|同学|女朋友|男朋友|朋友)`;

  // 遗忘："忘掉我妈妈" / "删除我妈妈的称呼"
  const forgetRel = text.match(new RegExp(`(?:忘掉|忘记|删除|不要记住)\\s*(?:我的?)?${relWord}`));
  if (forgetRel) {
    output.push(candidate({
      type: "named_relation_forget",
      key: `namedRelationForget:${RELATION_MAP[forgetRel[1]]}`,
      value: { relation: RELATION_MAP[forgetRel[1]] },
      scope: "working",
      confidence: 0.95,
      reasonCode: "named_relation_forget",
      sourceTurnIds: turnId ? [turnId] : [],
      rawText: text.slice(0, 80),
    }));
  } else {
    // 陈述："我妈妈叫刘秀英" / "我爸是李刚"；名字后必须句末/标点/空格，防"叫我去吃饭"误匹配
    const relMatch = text.match(new RegExp(`(?:我的)?${relWord}(?:叫|是|的名字叫)\\s*([\\u3400-\\u9fff·]{2,4})(?=$|[\\s，。！？、,.!?])`));
    if (relMatch && !/^(什么|啥|谁|哪|怎么|如何|我|你|他|她|它|去|来|回)/.test(relMatch[2])) {
      output.push(candidate({
        type: "named_relation",
        key: `namedRelation:${RELATION_MAP[relMatch[1]]}`,
        value: {
          relation: RELATION_MAP[relMatch[1]],
          displayRelation: relMatch[1],
          name: relMatch[2],
        },
        scope: "working",
        confidence: isCorrection ? 0.95 : 0.85,
        reasonCode: isCorrection ? "user_correction" : "named_relation_statement",
        correction: isCorrection,
        sourceTurnIds: turnId ? [turnId] : [],
        rawText: text.slice(0, 80),
      }));
    }
  }

  return output.filter((item) => {
    if (item.scope === "user" && isTemporaryCandidate(item)) return false;
    return true;
  });
}

/**
 * Optional piggyback on existing provider structured output (same turn).
 * Never triggers a third model call.
 */
function extractFromProviderPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const list = payload.memoryCandidates || payload.memory_candidates;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 8).map((item) => candidate({
    type: item.type,
    key: item.key,
    value: item.value,
    scope: item.scope || "user",
    confidence: Number(item.confidence || 0.75),
    reasonCode: item.reasonCode || "provider_structured",
    source: "provider_payload",
    sensitivity: item.sensitivity || "low",
  })).filter((item) => item.key);
}

function extractMemoryCandidates(input = {}) {
  const fromMessage = extractFromMessage(input.message, {
    turnId: input.turnId || input.runId || "",
  });
  const fromProvider = extractFromProviderPayload(input.providerPayload);
  return fromMessage.concat(fromProvider);
}

module.exports = {
  extractFromMessage,
  extractFromProviderPayload,
  extractMemoryCandidates,
};
