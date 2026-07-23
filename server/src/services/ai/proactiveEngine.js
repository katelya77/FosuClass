/**
 * Event-driven proactive suggestions — no background model polling.
 * Deterministic rules + cooldown; facts must come from tools/context.
 */

const safetyGuard = require("./safetyGuard");

const COOLDOWN_MS = Object.freeze({
  next_course: 30 * 60 * 1000,
  room_change: 2 * 60 * 60 * 1000,
  back_to_back: 60 * 60 * 1000,
  free_gap: 4 * 60 * 60 * 1000,
  rain_commute: 3 * 60 * 60 * 1000,
  nearby_empty_room: 2 * 60 * 60 * 1000,
  schedule_conflict: 12 * 60 * 60 * 1000,
  reminder_not_enabled: 24 * 60 * 60 * 1000,
});

const TRIGGER_EVENTS = Object.freeze([
  "assistant_open",
  "today_schedule_open",
  "personal_schedule_imported",
  "release_pack_changed",
  "schedule_conflict_detected",
  "reminder_due_soon",
  "campus_task_completed",
]);

// In-process cooldown store (per principal hash key). Durable enough for single instance.
const cooldownStore = new Map();

function cooldownKey(principalKey, suggestionType) {
  return `${String(principalKey || "anon").slice(0, 64)}:${suggestionType}`;
}

function isCooledDown(principalKey, suggestionType, now = Date.now()) {
  const key = cooldownKey(principalKey, suggestionType);
  const until = cooldownStore.get(key) || 0;
  return now < until;
}

function markShown(principalKey, suggestionType, now = Date.now()) {
  const ttl = COOLDOWN_MS[suggestionType] || 60 * 60 * 1000;
  cooldownStore.set(cooldownKey(principalKey, suggestionType), now + ttl);
}

function clearCooldowns(principalKey) {
  const prefix = `${String(principalKey || "anon").slice(0, 64)}:`;
  Array.from(cooldownStore.keys()).forEach((key) => {
    if (key.startsWith(prefix)) cooldownStore.delete(key);
  });
}

function disabledTypes(context = {}) {
  const list = context.disabledProactiveTypes || context.proactiveOptOut || [];
  return new Set(Array.isArray(list) ? list.map(String) : []);
}

function buildSuggestion(type, title, body, actions = []) {
  return {
    type,
    title: safetyGuard.redactSensitiveText(String(title || "")).slice(0, 40),
    body: safetyGuard.redactSensitiveText(String(body || "")).slice(0, 120),
    actions: (Array.isArray(actions) ? actions : []).slice(0, 2),
    source: "proactive_engine",
  };
}

/**
 * Evaluate one high-value suggestion for a trigger event.
 * Never invents schedule facts — only uses provided tool/context facts.
 */
function evaluateProactive(input = {}) {
  const event = String(input.event || "");
  if (!TRIGGER_EVENTS.includes(event)) {
    return { suggestion: null, reason: "unknown_event" };
  }
  const principalKey = input.principal && input.principal.principalKey || input.principalKey || "";
  const context = input.context || {};
  const facts = input.facts || {};
  const optOut = disabledTypes(context);
  const now = Date.now();

  const candidates = [];

  if (facts.nextCourse && facts.nextCourse.name) {
    candidates.push({
      type: "next_course",
      priority: 90,
      suggestion: buildSuggestion(
        "next_course",
        "下一节课提醒",
        `${facts.nextCourse.name}${facts.nextCourse.room ? ` · ${facts.nextCourse.room}` : ""}${facts.nextCourse.leaveBy ? `，建议 ${facts.nextCourse.leaveBy} 前出发` : ""}`,
        [{ label: "查看今日课表", type: "navigate", payload: { url: "/pages/index/index" } }]
      ),
    });
  }

  if (facts.roomChanged && facts.roomChanged.courseName) {
    candidates.push({
      type: "room_change",
      priority: 95,
      suggestion: buildSuggestion(
        "room_change",
        "教室有变化",
        `${facts.roomChanged.courseName} 教室调整为 ${facts.roomChanged.newRoom || "见课表"}`,
        []
      ),
    });
  }

  if (facts.backToBack === true) {
    candidates.push({
      type: "back_to_back",
      priority: 80,
      suggestion: buildSuggestion("back_to_back", "连续赶课", "今天有连续课程，预留换教室时间。", []),
    });
  }

  if (facts.freeGap && facts.freeGap.sections) {
    candidates.push({
      type: "free_gap",
      priority: 70,
      suggestion: buildSuggestion(
        "free_gap",
        "今日有空档",
        `大约 ${facts.freeGap.sections} 有空档，需要的话我可以帮你找附近空教室。`,
        [{ label: "找空教室", type: "retry", payload: { message: "帮我找现在空教室" } }]
      ),
    });
  }

  if (facts.weather && /雨|雷|暴雨/.test(String(facts.weather.summary || facts.weather.text || ""))) {
    candidates.push({
      type: "rain_commute",
      priority: 75,
      suggestion: buildSuggestion(
        "rain_commute",
        "出行提醒",
        `天气：${String(facts.weather.summary || facts.weather.text).slice(0, 40)}，出门记得带伞。`,
        []
      ),
    });
  }

  if (facts.nearbyEmptyRoom && facts.nearbyEmptyRoom.room) {
    candidates.push({
      type: "nearby_empty_room",
      priority: 65,
      suggestion: buildSuggestion(
        "nearby_empty_room",
        "空档可用教室",
        `${facts.nearbyEmptyRoom.room} 当前空闲`,
        []
      ),
    });
  }

  if (facts.scheduleConflict === true || facts.missingClassroom === true) {
    candidates.push({
      type: "schedule_conflict",
      priority: 92,
      suggestion: buildSuggestion(
        "schedule_conflict",
        "课表需留意",
        facts.scheduleConflict ? "检测到课表冲突，建议打开课表核对。" : "有课程缺少教室信息。",
        [{ label: "检查课表", type: "retry", payload: { message: "帮我检查课表冲突" } }]
      ),
    });
  }

  if (facts.reminderEnabled === false && (event === "assistant_open" || event === "personal_schedule_imported")) {
    candidates.push({
      type: "reminder_not_enabled",
      priority: 50,
      suggestion: buildSuggestion(
        "reminder_not_enabled",
        "尚未开启课程提醒",
        "可以让我在上课前提醒你，需要的话说“上课前20分钟提醒我”。",
        [{ label: "设置提醒", type: "manageReminders", payload: { openCreate: true } }]
      ),
    });
  }

  // Post-task soft follow-ups only when event is campus_task_completed
  if (event === "campus_task_completed" && facts.followUpHint) {
    candidates.push({
      type: "free_gap",
      priority: 40,
      suggestion: buildSuggestion(
        "free_gap",
        "还需要帮忙吗",
        safetyGuard.redactSensitiveText(String(facts.followUpHint)).slice(0, 80),
        []
      ),
    });
  }

  const ranked = candidates
    .filter((c) => !optOut.has(c.type))
    .filter((c) => !isCooledDown(principalKey, c.type, now))
    .sort((a, b) => b.priority - a.priority);

  if (!ranked.length) {
    return { suggestion: null, reason: "no_candidate_or_cooled_down" };
  }

  const top = ranked[0];
  markShown(principalKey, top.type, now);
  return {
    suggestion: top.suggestion,
    reason: "ok",
    event,
    cooledTypes: ranked.slice(1).map((c) => c.type),
  };
}

/**
 * Lightweight facts from recent tool calls (no extra tool invocation).
 */
function factsFromToolCalls(toolCalls = []) {
  const facts = {};
  (Array.isArray(toolCalls) ? toolCalls : []).forEach((call) => {
    const name = call && call.name;
    const result = call && call.result || {};
    if (name === "get_next_course" && result.success !== false && result.course) {
      facts.nextCourse = {
        name: result.course.name || result.course.courseName,
        room: result.course.room || result.course.classroom,
        leaveBy: result.leaveBy || result.suggestedLeaveTime,
      };
    }
    if (name === "get_campus_weather" && result.success !== false) {
      facts.weather = {
        summary: result.summary || result.text || result.weather || "",
        text: result.text || "",
      };
    }
    if ((name === "inspect_schedule_conflicts" || name === "detect_schedule_changes")
      && result.success !== false) {
      if (result.conflictCount > 0 || (Array.isArray(result.conflicts) && result.conflicts.length)) {
        facts.scheduleConflict = true;
      }
      if (result.hasChanges) {
        facts.roomChanged = {
          courseName: result.changedCourseName || "课程",
          newRoom: result.newRoom || "",
        };
      }
    }
    if ((name === "search_empty_rooms" || name === "search_continuous_empty_rooms")
      && result.success !== false) {
      const rooms = result.rooms || result.items || [];
      if (rooms[0]) {
        facts.nearbyEmptyRoom = {
          room: rooms[0].room || rooms[0].classroom || rooms[0].name,
        };
      }
    }
  });
  return facts;
}

module.exports = {
  TRIGGER_EVENTS,
  COOLDOWN_MS,
  evaluateProactive,
  factsFromToolCalls,
  isCooledDown,
  markShown,
  clearCooldowns,
};
