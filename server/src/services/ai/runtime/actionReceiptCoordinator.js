const crypto = require("crypto");
const { defaultCourseReminderService } = require("../reminders/courseReminderService");

function reminderIdempotencyKey(principal, operation, payload, reminderId) {
  const courseTemplates = Array.isArray(payload && payload.courseTemplates)
    ? payload.courseTemplates.map((course) => ({
      name: course.courseName || "",
      weekday: Number(course.weekday || 0),
      startSection: Number(course.startSection || 0),
      weeks: Array.isArray(course.weeks) ? course.weeks : [],
    }))
    : [];
  const digest = crypto.createHash("sha256").update(JSON.stringify({
    principal: principal && principal.principalKey || "",
    operation,
    reminderId: reminderId || "",
    scope: payload && payload.scope || "",
    leadMinutes: payload && payload.leadMinutes || 0,
    targetDate: payload && payload.targetDate || "",
    scheduleFingerprint: payload && payload.scheduleFingerprint || "",
    courseTemplates,
  })).digest("hex").slice(0, 40);
  return `course-reminder:${operation}:${digest}`;
}

/**
 * Confirmation capabilities are attached only after response/provider composition.
 * They never enter tool observations, model context, conversation memory, or trace logs.
 */
function attachReminderConfirmation(response, execution, principal) {
  if (!response || !execution || !principal || principal.authenticated !== true) return response;
  const calls = Array.isArray(execution.toolCalls) ? execution.toolCalls : [];
  const createCall = calls.find((item) => item && item.name === "create_course_reminder");
  const deleteCall = calls.find((item) => item && item.name === "delete_course_reminder");
  let operation = "";
  let payload = null;
  let reminderId = "";
  if (createCall && createCall.result && createCall.result.success === true && createCall.result.requiresConfirmation === true) {
    operation = "create";
    payload = createCall.result;
  } else if (deleteCall && deleteCall.result && deleteCall.result.requiresConfirmation === true
    && Array.isArray(deleteCall.result.matches) && deleteCall.result.matches.length === 1) {
    operation = "delete";
    payload = {};
    reminderId = String(deleteCall.result.matches[0].id || "");
  }
  if (!operation || operation === "delete" && !reminderId) return response;

  try {
    const idempotencyKey = reminderIdempotencyKey(principal, operation, payload, reminderId);
    const confirmation = defaultCourseReminderService.createConfirmation({
      principal,
      operation,
      reminderId,
      payload,
      idempotencyKey,
    });
    const attachToCards = (cards) => {
      (Array.isArray(cards) ? cards : []).forEach((card) => {
        (Array.isArray(card && card.actions) ? card.actions : []).forEach((action) => {
          if (!action || action.type !== "confirmReminder") return;
          // Keep lead/scope for one-tap client configure path; proof remains as secondary fallback.
          action.payload = Object.assign({}, action.payload || {}, {
            operation,
            reminderId,
            idempotencyKey,
            confirmationProof: confirmation.token,
            confirmationExpiresAt: confirmation.expiresAt,
            leadMinutes: Number((payload && payload.leadMinutes) || (action.payload && action.payload.leadMinutes) || 20) || 20,
            scope: String((payload && payload.scope) || (action.payload && action.payload.scope) || "all_courses").slice(0, 32),
          });
        });
      });
    };
    attachToCards(response.cards);
    if (response.presentation && response.presentation.cards !== response.cards) {
      attachToCards(response.presentation.cards);
    }
  } catch (error) {
    (Array.isArray(response.cards) ? response.cards : []).forEach((card) => {
      (Array.isArray(card && card.actions) ? card.actions : []).forEach((action) => {
        if (action && action.type === "confirmReminder") {
          action.type = "noop";
          action.toast = error && error.code === "REMINDER_SECRET_UNAVAILABLE"
            ? "提醒服务尚未配置，请稍后再试"
            : "暂时无法确认提醒";
          action.payload = {};
        }
      });
    });
  }
  return response;
}

const SCHEDULE_TYPE_LABELS = {
  class: "班级课表",
  teacher: "教师课表",
  classroom: "教室课表",
  course: "课程课表",
  room: "教室课表",
};

function scheduleOpenLabel(type) {
  const key = String(type || "class").trim();
  return `打开${SCHEDULE_TYPE_LABELS[key] || "课表"}`;
}

function buildScheduleNavigateAction(type, item, meta = {}) {
  const id = String((item && (item.id || item.detailId)) || meta.id || "").slice(0, 128);
  const name = String(
    (item && (item.name || item.teacherName || item.className || item.roomName || item.courseName || item.displayName))
    || meta.name
    || ""
  ).slice(0, 120);
  const releaseVersion = String(
    (item && item.releaseVersion) || meta.releaseVersion || ""
  ).slice(0, 40);
  const term = String((item && (item.term || item.semester)) || meta.term || "").slice(0, 40);
  const safeType = String(type || meta.type || "class").slice(0, 20);
  if (!id) {
    // detailId missing → school page with pending query
    return {
      command: "navigate",
      label: "打开全校查询",
      input: {
        url: "/pages/school/school",
        params: {
          type: safeType,
          keyword: name,
          q: name,
          term,
          releaseVersion,
        },
      },
    };
  }
  return {
    command: "navigate",
    label: scheduleOpenLabel(safeType),
    input: {
      url: "/pages/schedule-view/schedule-view",
      params: {
        type: safeType,
        id,
        name,
        term,
        releaseVersion,
      },
    },
  };
}

// 从工具结果确定性派生 Action Command（模型不参与生成）。
// 1) set_current_schedule → setCurrentSchedule（需 explicitCommand + 索引校验）
// 2) 四类课表：唯一 search / get_schedule_detail → navigate 打开 schedule-view
// 无 success Receipt 不得声称写操作成功。
function deriveActionCommands(toolCalls = []) {
  const derived = [];
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  calls.forEach((call) => {
    if (!call || call.status !== "success") return;
    const result = call.result && typeof call.result === "object" ? call.result : call;

    if (call.name === "set_current_schedule") {
      if (result.actionRequired !== "setCurrentSchedule" || result.explicitCommand !== true) return;
      const target = result.target && typeof result.target === "object" ? result.target : {};
      if (!target.detailId || !target.name) return;
      const safeName = String(target.name).slice(0, 120);
      derived.push({
        command: "setCurrentSchedule",
        label: "设为首页课表",
        input: {
          type: "class",
          detailId: String(target.detailId).slice(0, 128),
          name: safeName,
          term: String(target.term || "").slice(0, 40),
          releaseVersion: String(target.releaseVersion || "").slice(0, 40),
        },
        confirmationRequest: {
          title: "设置首页课表",
          summary: `将首页课表切换为「${safeName.slice(0, 60)}」${target.term ? `（${String(target.term).slice(0, 40)}）` : ""}？`,
          confirmText: "确认设置",
          cancelText: "取消",
        },
      });
      return;
    }

    if (call.name === "get_schedule_detail" && result.success !== false && (result.id || result.detailId) && result.type) {
      const item = {
        id: result.id || result.detailId,
        detailId: result.detailId || result.id,
        name: result.name || result.displayName || "",
        term: result.term || result.semester || "",
        releaseVersion: result.releaseVersion || "",
      };
      derived.push(buildScheduleNavigateAction(result.type, item, {
        releaseVersion: result.releaseVersion,
        term: result.term || result.semester,
      }));
      return;
    }

    // Schedule search: unique → open schedule-view; multi → top candidates open + school fallback
    if (call.name === "search_school_index") {
      const items = Array.isArray(result.items) ? result.items : [];
      const type = String(result.type || result.lockedEntityType || "class").slice(0, 20);
      const isScheduleType = ["class", "teacher", "classroom", "course", "room"].includes(type);
      if (!isScheduleType) return;
      const meta = {
        releaseVersion: result.releaseVersion,
        term: result.term || result.semester,
      };
      if (items.length === 1) {
        derived.push(buildScheduleNavigateAction(type, items[0], meta));
      } else if (items.length > 1) {
        // Prefer per-candidate open actions so users can click a teacher card row / button
        items.slice(0, 3).forEach((item) => {
          const action = buildScheduleNavigateAction(type, item, meta);
          if (action && action.input && action.input.url && String(action.input.url).includes("schedule-view")) {
            const nm = String(item.name || item.teacherName || item.className || item.roomName || item.courseName || "").slice(0, 8);
            derived.push(Object.assign({}, action, {
              label: nm ? `打开${nm}${nm.length >= 8 ? "…" : ""}` : action.label,
            }));
          }
        });
        const q = String(result.q || (items[0] && (items[0].name || items[0].teacherName)) || "").slice(0, 80);
        derived.push({
          command: "navigate",
          label: "打开全校查询",
          input: {
            url: "/pages/school/school",
            params: {
              type,
              keyword: q,
              q,
              term: String(result.term || result.semester || "").slice(0, 40),
              releaseVersion: String(result.releaseVersion || "").slice(0, 40),
            },
          },
        });
      }
    }
  });
  // Allow up to 4 derived actions so multi-teacher open + school remain available
  return derived.slice(0, 4);
}

function deriveLastResolvedEntity(toolCalls = []) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (!call || call.status !== "success") continue;
    const result = call.result && typeof call.result === "object" ? call.result : {};
    let type = String(result.type || result.lockedEntityType || "").trim();
    let item = null;
    if (call.name === "get_schedule_detail") item = result;
    if (call.name === "search_school_index" && Array.isArray(result.items) && result.items.length === 1) {
      item = result.items[0];
    }
    if (!item && call.name === "set_current_schedule" && result.target) {
      item = result.target;
      type = "class";
    }
    if (!item || !["class", "teacher", "classroom", "course"].includes(type)) continue;
    const id = String(item.id || item.detailId || "").slice(0, 128);
    const name = String(
      item.name || item.teacherName || item.className || item.roomName || item.classroomName || item.courseName || ""
    ).slice(0, 120);
    if (id && name) return { type, id, name };
  }
  return undefined;
}

function derivePendingAction(actions = [], metadata = {}) {
  const action = (Array.isArray(actions) ? actions : []).find((item) =>
    item && item.command === "setCurrentSchedule" && item.confirmationRequest
  );
  if (!action) return undefined;
  const target = action.input && typeof action.input === "object" ? action.input : {};
  const createdAt = Date.now();
  return {
    command: "setCurrentSchedule",
    status: "awaiting_receipt",
    runId: String(metadata.runId || "").slice(0, 100),
    createdAt,
    expiresAt: createdAt + Math.max(60000, Math.min(3600000, Number(metadata.ttlMs || 15 * 60 * 1000) || 15 * 60 * 1000)),
    target: {
      type: "class",
      detailId: String(target.detailId || "").slice(0, 128),
      name: String(target.name || "").slice(0, 120),
      term: String(target.term || "").slice(0, 40),
    },
  };
}

module.exports = {
  reminderIdempotencyKey,
  attachReminderConfirmation,
  scheduleOpenLabel,
  buildScheduleNavigateAction,
  deriveActionCommands,
  deriveLastResolvedEntity,
  derivePendingAction,
};
