"use strict";
// R50.2B variant-adapters —— 确定性工具结果 → CampusResultEnvelope 投影层（2026-08-19）
//
// 规则：
//  - 纯函数：(raw, toolName) => { ok, errors, envelope }。
//  - 只读取 raw 中已核验事实，绝不编造/补全校园事实；未核验（success=false）只投影 error 变体。
//  - 输出不携带 queryId / dataHash / sourceTool / rankContext / temporalContext /
//    NodeID / VarBizID / token / 内部 URL / 原始内部协议；project() 末尾做 isClean 兜底。
//  - 输出确定性：同一 raw 输入字节级稳定（键序固定、无随机）。
const fs = require("fs");
const path = require("path");
const { isClean, validateEnvelope } = require("./envelope.js");
const { buildFollowUpActions } = require("./action-builder.js");

const MAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, "tool-variant-map.json"), "utf8")
).mapping;

const WEEKEND_NAMES = new Set(["周六", "周日"]);
const RECOVERABLE_ERRORS = new Set([
  "MISSING_PARAM", "INVALID_PARAM", "ENTITY_NOT_FOUND",
  "AMBIGUOUS_ENTITY", "OUT_OF_RANGE", "EMPTY_RESULT",
]);

function resolveVariant(toolName) {
  return MAP[toolName] || null;
}

function lessonRow(lesson) {
  const people = [...(lesson.teachers || []), ...(lesson.classes || [])].join(" · ");
  return {
    label: `${lesson.weekdayName} ${lesson.periodText}`,
    value: `${lesson.courseName} · ${lesson.campusName} ${lesson.roomName || "教室未定"}`,
    badge: lesson.periodText,
    hint: [lesson.startTime && lesson.endTime ? `${lesson.startTime}-${lesson.endTime}` : null, people || null]
      .filter(Boolean).join(" · "),
  };
}

function groupLabel(name) {
  return String(name || "").split("、").slice(0, 3).join("、");
}

function isWeekendItem(item) {
  return (item.weekday != null && item.weekday >= 6) || WEEKEND_NAMES.has(item.weekdayName);
}

function isVerified(raw) {
  return raw && raw.success === true && raw.evidence && raw.evidence.verified === true;
}

// ---------------------------------------------------------------------------
// schedule：单周 / 多周 / 日计划
// ---------------------------------------------------------------------------
function projectSchedule(raw, toolName) {
  if (!isVerified(raw)) return projectError(raw, toolName);
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (items.length === 0) return projectEmpty(raw);
  const entityName = raw.resolvedEntity && raw.resolvedEntity.name
    ? raw.resolvedEntity.name
    : raw.query && raw.query.entityName || "";
  const weekText = toolName === "campus_day_plan"
    ? ""
    : raw.window && raw.window.weekStart && raw.window.weekEnd
      ? raw.window.weekStart === raw.window.weekEnd
        ? `第${raw.window.weekStart}周`
        : `第${raw.window.weekStart}-${raw.window.weekEnd}周`
      : "第1周";
  const title = toolName === "campus_day_plan"
    ? `${entityName || "今日"}校园计划`
    : `${entityName} · ${weekText}课表`;

  const lessons = [];
  const notes = [];
  for (const item of items) {
    if (item && item.type && item.type !== "lesson") {
      if (item.type === "gap" || item.type === "tip") {
        notes.push(`${item.type === "gap" ? "空闲" : "建议"}：${item.text || ""}`);
      }
      continue;
    }
    const lesson = item && item.lesson ? item.lesson : item;
    if (lesson && lesson.courseName) lessons.push(lesson);
  }

  const sections = [];
  if (lessons.length) {
    sections.push({ title: "课程列表", rows: lessons.map(lessonRow) });
  }
  if (notes.length) {
    sections.push({ title: "补充说明", note: notes.join("；"), rows: [] });
  }
  const summary = lessons.length
    ? `${weekText || "当日"}共 ${lessons.length} 条课程。`
    : "暂无已核验课程记录。";
  return finishEnvelope(raw, {
    variant: "schedule",
    status: "success",
    title,
    subtitle: `${entityName}${weekText ? ` · ${weekText}` : ""}`,
    verified: true,
    summary,
    context: windowText(raw),
    sections,
    displayMeta: {},
  });
}

// ---------------------------------------------------------------------------
// space：空教室 / 空间
// ---------------------------------------------------------------------------
function projectSpace(raw) {
  if (!isVerified(raw)) return projectError(raw, "space");
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (items.length === 0) return projectEmpty(raw);
  const campusName = raw.resolvedEntity && raw.resolvedEntity.name || "";
  const rows = items.slice(0, 5).map((room) => ({
    label: `${room.roomName || ""}${room.capacity ? ` · ${room.capacity}人` : ""}`,
    value: `${room.type || "教室"} · ${room.campusName || campusName || ""}${room.building ? ` ${room.building}` : ""}`,
    badge: room.type || undefined,
    hint: undefined,
  }));
  const summary = rows.length
    ? `找到 ${items.length} 间符合条件的教室。`
    : "该时段没有已核验的空教室。";
  return finishEnvelope(raw, {
    variant: "space",
    status: "success",
    title: `${campusName || "校园"}空教室`,
    subtitle: slotText(raw),
    verified: true,
    summary,
    context: slotText(raw),
    sections: [
      { title: "推荐教室", rows: rows.slice(0, 1) },
      {
        title: "其他选择",
        rows: rows.slice(1),
        ...(items.length > rows.length ? { note: `还有 ${items.length - rows.length} 间符合条件` } : {}),
      },
    ],
    displayMeta: {},
  });
}

// ---------------------------------------------------------------------------
// collaboration：共同空闲（common_free_time / plan_group）
// ---------------------------------------------------------------------------
function projectCollaboration(raw) {
  if (!isVerified(raw)) return projectError(raw, "collaboration");
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (items.length === 0) return projectEmpty(raw);
  const recommended = items[0];
  const hasRooms = Array.isArray(recommended.rooms) && recommended.rooms.length > 0;
  const weekendMarked = items.some(isWeekendItem);
  const explicitPeople = Array.isArray(recommended.entities) ? recommended.entities.map((entry) => entry && entry.name).filter(Boolean) : [];
  const people = explicitPeople.length
    ? explicitPeople
    : raw.resolvedEntity && typeof raw.resolvedEntity.name === "string"
      ? raw.resolvedEntity.name.split(/[、，,]/).map((name) => name.trim()).filter(Boolean).slice(0, 8)
      : [];
  const entityText = raw.resolvedEntity && raw.resolvedEntity.name
    ? groupLabel(raw.resolvedEntity.name)
    : people.length ? people.join(" · ") : "多方";
  const rooms = hasRooms ? recommended.rooms : [];
  const firstRoom = rooms[0];
  const minCapacity = Number(raw.query && raw.query.minCapacity);
  const expectedSpan = Number(recommended.periodEnd) - Number(recommended.periodStart) + 1;
  const whyRows = [];
  if (people.length && recommended.freePeriodCount != null) {
    whyRows.push({ label: "共同空闲", value: `${people.length} 位教师均空闲`, badge: "已核验" });
  }
  if (firstRoom && Number.isFinite(minCapacity) && Number(firstRoom.capacity) >= minCapacity) {
    whyRows.push({ label: "空间容量", value: "容量满足需求", hint: `${firstRoom.capacity} 人` });
  }
  if (Number.isFinite(expectedSpan) && expectedSpan > 0 && Number(recommended.freePeriodCount) >= expectedSpan) {
    whyRows.push({ label: "时段衔接", value: "时间连续", hint: `${recommended.freePeriodCount} 节` });
  }
  const sections = [{
    title: "推荐方案",
    rows: [{
      label: `${recommended.weekdayName || ""} ${recommended.periodText || ""}`.trim(),
      value: people.length ? people.join(" · ") : `${recommended.freePeriodCount || ""} 节共同空闲`,
      badge: isWeekendItem(recommended) ? "周末" : "首选",
    }],
  }];
  if (people.length) sections.push({ title: "参与", rows: [{ label: "参与人员", value: people.join(" · ") }] });
  if (firstRoom) {
    sections.push({ title: "首选空间", rows: [{
      label: firstRoom.roomName || "教室",
      value: `${firstRoom.capacity ? `${firstRoom.capacity} 人 · ` : ""}${firstRoom.campusName || ""}${firstRoom.building ? ` · ${firstRoom.building}` : ""}`,
      badge: "推荐",
    }] });
  }
  if (whyRows.length) sections.push({ title: "为什么推荐", rows: whyRows });
  if (rooms.length > 1) {
    const alternatives = rooms.slice(1, 4);
    sections.push({
      title: "备选空间",
      rows: alternatives.map((room) => ({
        label: room.roomName || "教室",
        value: `${room.capacity ? `${room.capacity} 人 · ` : ""}${room.campusName || ""}`,
      })),
      ...(rooms.length > 4 ? { note: `还有 ${rooms.length - 4} 个空间候选` } : {}),
    });
  }
  const summary = items.length
    ? `推荐 ${recommended.weekdayName || ""} ${recommended.periodText || ""}${firstRoom ? `，首选 ${firstRoom.roomName}` : ""}。`
    : "该条件下没有已核验的共同空闲时段。";
  return finishEnvelope(raw, {
    variant: "collaboration",
    status: "success",
    title: `${entityText} · 共同空闲`,
    subtitle: slotText(raw),
    verified: true,
    summary,
    context: slotText(raw),
    sections,
    displayMeta: { weekendMarked: weekendMarked || undefined },
  });
}

// ---------------------------------------------------------------------------
// risk：时间冲突 + 跨校区赶场
// ---------------------------------------------------------------------------
function projectRisk(raw) {
  if (!isVerified(raw)) return projectError(raw, "risk");
  const summary = raw.summary || {};
  const conflicts = Array.isArray(raw.items) ? raw.items : [];
  const rushes = Array.isArray(raw.rushWarnings) ? raw.rushWarnings : [];
  const compared = (raw.compared || []).map((e) => e.name).filter(Boolean).join(" 与 ");
  const subject = raw.resolvedEntity && raw.resolvedEntity.name || raw.query && raw.query.entityName || compared || "教学安排";
  const week = windowText(raw) || "";
  const conflictRows = conflicts.map((conflict) => ({
    label: `${conflict.weekdayName || ""} ${conflict.periodText || (conflict.periodStart != null && conflict.periodEnd != null ? `第${conflict.periodStart}-${conflict.periodEnd}节` : "")}`.trim(),
    value: `${conflict.first ? conflict.first.courseName : ""} ↔ ${conflict.second ? conflict.second.courseName : ""}`,
    badge: "冲突",
    hint: `${conflict.first ? `${conflict.first.campusName} ${conflict.first.roomName}` : ""}；${conflict.second ? `${conflict.second.campusName} ${conflict.second.roomName}` : ""}`,
  }));
  const rushRows = rushes.map((rush) => ({
    label: `${rush.weekdayName || ""}${rush.from && rush.from.endTime ? ` · ${rush.from.endTime}` : ""}${rush.to && rush.to.startTime ? ` → ${rush.to.startTime}` : ""}`,
    value: `${rush.from ? rush.from.courseName : ""} → ${rush.to ? rush.to.courseName : ""}`,
    badge: "赶场",
    hint: `${rush.from ? rush.from.campusName : ""} → ${rush.to ? rush.to.campusName : ""} · 间隔 ${rush.gapMinutes} 分钟`,
  }));
  const sections = [];
  if (conflictRows.length) sections.push({ title: "时间冲突", rows: conflictRows });
  if (rushRows.length) sections.push({ title: "跨校区衔接", rows: rushRows });
  const hasConflict = summary.hasConflict === true || conflicts.length > 0;
  const summaryText = hasConflict
    ? `发现 ${conflicts.length} 处时间冲突${summary.rushWarningCount ? `、${summary.rushWarningCount} 处跨校区赶场` : ""}。`
    : summary.rushWarningCount
      ? `存在 ${summary.rushWarningCount} 项跨校区赶场提醒。`
      : "未发现时间冲突或跨校区赶场。";
  sections.push({
    title: "结论",
    rows: [
      { label: "课程安排", value: hasConflict ? "存在时间冲突" : "课程本身无时间冲突", badge: hasConflict ? "需处理" : "正常" },
      ...(rushRows.length ? [{ label: "跨校区衔接", value: "预留时间较紧", badge: "提醒" }] : []),
    ],
  });
  return finishEnvelope(raw, {
    variant: "risk",
    status: "success",
    title: [subject, week, "教学风险"].filter(Boolean).join(" · "),
    subtitle: week || slotText(raw),
    verified: true,
    summary: summaryText,
    context: week || slotText(raw),
    sections,
    displayMeta: {},
  });
}

// ---------------------------------------------------------------------------
// reschedule：调课模拟（不写回）
// ---------------------------------------------------------------------------
function projectReschedule(raw) {
  if (!isVerified(raw)) return projectError(raw, "reschedule");
  const item = Array.isArray(raw.items) && raw.items[0] ? raw.items[0] : null;
  const source = item && item.sourceLesson ? item.sourceLesson : null;
  const target = item && item.target ? item.target : null;
  const summary = raw.summary || {};
  const simulated = !(raw.simulation && raw.simulation.mutatedData === true);
  const sections = [];
  if (source) {
    sections.push({ title: "原安排", rows: [{
      label: `${source.weekdayName} ${source.periodText}`,
      value: `${source.courseName} · ${source.campusName} ${source.roomName || ""}`,
      badge: "当前",
      hint: (source.teachers || []).join("、") || undefined,
    }] });
  }
  if (target) {
    sections.push({ title: "候选安排", rows: [{
      label: `${target.weekdayName} ${target.periodText}`,
      value: summary.feasible ? "可行：教师与班级时间无冲突" : summary.reason || "不可行",
      badge: summary.feasible ? "可行" : "不可行",
      hint: target.room ? `${target.room.campusName || ""} ${target.room.name || ""}` : "教室待指定",
    }] });
  }
  const checks = item && item.checks || {};
  const checkRows = [
    ["教师", checks.teacherConflict, "conflict"],
    ["班级", checks.classConflict, "conflict"],
    ["教室", checks.roomConflict, "conflict"],
    ["容量", checks.capacity, "ok"],
    ["教室属性", checks.feature, "ok"],
  ].filter(([, check]) => check && typeof check === "object").map(([label, check, mode]) => ({
    label,
    value: mode === "conflict" ? (check.conflict ? "存在冲突" : "无冲突") : (check.ok ? "满足" : "不满足"),
  }));
  if (checkRows.length) sections.push({ title: "可行性检查", rows: checkRows });
  const title = source ? `调课模拟 · ${source.courseName}` : "调课模拟";
  const summaryText = summary.feasible
    ? `可以调至 ${target ? `${target.weekdayName} ${target.periodText}` : "目标时段"}${simulated ? "（模拟，未执行）" : ""}。`
    : summary.reason || "当前目标不可行。";
  return finishEnvelope(raw, {
    variant: "reschedule",
    status: "success",
    title,
    subtitle: "模拟结果 · 未写入课表",
    verified: true,
    summary: summaryText,
    context: simulated ? "调课结果为模拟，未对课表做任何修改" : undefined,
    sections: sections.map((section, index) => index === sections.length - 1 && simulated
      ? { ...section, note: "仅为模拟，未修改课表" }
      : section),
    displayMeta: { simulated: simulated || undefined },
  });
}

// ---------------------------------------------------------------------------
// ranking：负载/利用率排行（保留 tie 语义与稳定位次）
// ---------------------------------------------------------------------------
function projectRanking(raw) {
  if (!isVerified(raw)) return projectError(raw, "ranking");
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (items.length === 0) return projectEmpty(raw);
  const ties = items.filter((item) => item.tiedWithPrevious);
  const rows = items.slice(1, 4).map((item) => ({
    label: `第${item.rank}名`,
    value: `${item.entity ? item.entity.name : ""} · ${metricText(item.metrics, item.data)}`,
    badge: item.tiedWithPrevious ? "并列" : undefined,
    hint: publicEntityType(item.entity && item.entity.type),
  }));
  const title = (raw.summary && raw.summary.metric === "utilizationRate" ? "教室利用率" : "教师负载") + "排行";
  const windowLabel = (raw.summary && raw.summary.windowLabel) || slotText(raw) || "第1周";
  const top = items[0];
  const summary = top
    ? `第1名 ${top.entity ? top.entity.name : ""} · ${metricText(top.metrics, top.data)}。`
    : "暂无已核验排行结果。";
  return finishEnvelope(raw, {
    variant: "ranking",
    status: "success",
    title,
    subtitle: `${windowLabel} · 由课程数据派生`,
    verified: true,
    summary,
    context: windowLabel,
    sections: [{
      title: "其他排名",
      rows,
      ...(items.length > 4 ? { note: `还有 ${items.length - 4} 个排名结果` } : {}),
    }],
    displayMeta: {
      tieGroupCount: new Set(items.filter((i) => i.tieGroupId).map((i) => i.tieGroupId)).size || undefined,
      tieNote: ties.length ? `第${firstTieRank(items)}名起并列` : undefined,
    },
  });
}

function publicEntityType(type) {
  return ({ teacher: "教师", room: "教室", building: "教学楼", campus: "校区", class: "班级", course: "课程" })[type] || undefined;
}

function metricText(metrics, data) {
  if (!metrics) return "";
  const parts = [];
  for (const key of Object.keys(metrics)) {
    const value = metrics[key];
    if (key === "loadCount") parts.push(`${value} 次授课`);
    else if (key === "utilizationRate") parts.push(`利用率 ${value}%`);
    else if (key === "lessonOccurrences") parts.push(`${value} 次授课`);
    else if (key === "periodUnits") parts.push(`${value} 课时`);
  }
  if (data && data.periodCount != null) parts.push(`${data.periodCount} 课时`);
  return parts.join(" · ");
}

function firstTieRank(items) {
  const first = items.find((item) => item.tiedWithPrevious);
  return first ? first.rank : null;
}

// ---------------------------------------------------------------------------
// overview：校园教学态势
// ---------------------------------------------------------------------------
function projectOverview(raw) {
  if (!isVerified(raw)) return projectError(raw, "overview");
  const item = Array.isArray(raw.items) && raw.items[0] ? raw.items[0] : {};
  const teachers = Array.isArray(item.teachers) ? item.teachers : [];
  const risks = item.risks || {};
  const weeks = Array.isArray(item.weeks) ? item.weeks : [];
  const sections = [];
  if (weeks.length) {
    const rows = weeks.slice(0, 2).map((week) => ({
      label: `第${week.week}周`,
      value: (week.perWeekday || []).map((count, index) => `${["一", "二", "三", "四", "五"][index]}${count}`).join(" · "),
    }));
    sections.push({ title: "各周课程量（周一至周五）", rows });
  }
  if (teachers.length) {
    sections.push({
      title: "教师负载 Top 3",
      rows: teachers.slice(0, 2).map((teacher) => ({
        label: `第${teacher.rank}名`,
        value: `${teacher.name} · ${teacher.lessonCount} 次课程`,
        badge: `第${teacher.rank}名`,
        hint: `${teacher.periodCount} 节次`,
      })),
    });
  }
  const riskRows = [];
  if (risks.conflictCount != null) riskRows.push({ label: "时间冲突", value: `${risks.conflictCount} 处`, badge: risks.conflictCount > 0 ? "关注" : "正常" });
  if (risks.rushCount != null) riskRows.push({ label: "跨校区赶场", value: `${risks.rushCount} 次`, badge: risks.rushCount > 0 ? "关注" : "正常" });
  if (risks.continuousCount != null) riskRows.push({ label: "连续课风险", value: `${risks.continuousCount} 次`, badge: risks.continuousCount > 0 ? "关注" : "正常" });
  if (riskRows.length) sections.push({ title: "教学风险", note: risks.rushFocus || undefined, rows: riskRows });
  const summary = item.summary || raw.summary || "校园教学态势已核验。";
  return finishEnvelope(raw, {
    variant: "overview",
    status: "success",
    title: "校园教学态势",
    subtitle: windowText(raw),
    verified: true,
    summary,
    context: windowText(raw),
    sections,
    displayMeta: {},
  });
}

// ---------------------------------------------------------------------------
// empty：verified empty
// ---------------------------------------------------------------------------
function projectEmpty(raw) {
  const entityName = raw.resolvedEntity && raw.resolvedEntity.name ? `「${raw.resolvedEntity.name}」` : "";
  return finishEnvelope(raw, {
    variant: "empty",
    status: "empty",
    title: "当前条件下没有匹配结果",
    subtitle: slotText(raw) || undefined,
    verified: isVerified(raw),
    summary: `${entityName}当前条件下没有匹配结果。可调整容量、校区或时间后再试。`,
    context: windowText(raw) || undefined,
    sections: [],
    displayMeta: {},
  });
}

// ---------------------------------------------------------------------------
// error：可恢复失败（只做用户语义转述，不携带内部错误协议）
// ---------------------------------------------------------------------------
function projectError(raw) {
  const code = raw && raw.error && raw.error.code;
  const recoverable = RECOVERABLE_ERRORS.has(code) || code === undefined;
  const message = code === "ENTITY_NOT_FOUND"
    ? "没有找到对应的教师/班级/教室，请检查名称或换一种问法。"
    : code === "AMBIGUOUS_ENTITY"
      ? "找到多个相似结果，请补充信息以便确认。"
      : code === "MISSING_PARAM" || code === "INVALID_PARAM" || code === "OUT_OF_RANGE"
        ? "本次查询缺少必要信息或范围无效，请补充后再试。"
        : code === "EMPTY_RESULT"
          ? "该条件下没有结果，可放宽范围再试。"
          : "暂时无法完成查询，请稍后重试。";
  return finishEnvelope(raw, {
    variant: "error",
    status: "error",
    title: "本次查询暂时没有完成",
    verified: false,
    summary: message,
    sections: [],
    displayMeta: { recoverable: recoverable || undefined },
  });
}

// ---------------------------------------------------------------------------
// message：轻量结构化结果（支撑类工具作为最终答案）
// ---------------------------------------------------------------------------
function projectMessage(raw) {
  const verified = isVerified(raw);
  const items = Array.isArray(raw.items) ? raw.items : [];
  const rows = items.map((item) => ({
    label: item.name || String(item.id || item.key || ""),
    value: item.note || item.value || "",
    badge: item.type || undefined,
  }));
  return finishEnvelope(raw, {
    variant: "message",
    status: verified ? "success" : "error",
    title: "查询结果",
    subtitle: slotText(raw) || undefined,
    verified,
    summary: verified ? `共 ${items.length} 条结果。` : "暂时无法完成查询，请稍后重试。",
    sections: rows.length ? [{ title: "结果列表", rows }] : [],
    displayMeta: {},
  });
}

// ---------------------------------------------------------------------------
// 公共装配
// ---------------------------------------------------------------------------
function finishEnvelope(raw, partial) {
  const envelope = compactObject({
    version: "1.0",
    variant: partial.variant,
    status: partial.status,
    title: partial.title,
    verified: partial.verified,
    summary: partial.summary,
    ...(partial.subtitle ? { subtitle: partial.subtitle } : {}),
    ...(partial.context ? { context: partial.context } : {}),
    sections: partial.sections || [],
    actions: buildFollowUpActions(partial.variant, { raw, title: partial.title }),
    displayMeta: { ...(partial.displayMeta || {}) },
  });
  const validation = validateEnvelope(envelope);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, envelope: null };
  }
  const leak = isClean(envelope);
  if (!leak.ok) {
    return { ok: false, errors: [`投影产物泄漏内部字段：${leak.violations.map((v) => v.field || v.pattern).join(",")}`], envelope: null };
  }
  return { ok: true, errors: [], envelope };
}

// 移除值为 undefined 的键（保持 JSON 序列化与内存对象一致，字节稳定）。
function compactObject(node) {
  if (Array.isArray(node)) return node.map(compactObject);
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (value === undefined) continue;
      out[key] = compactObject(value);
    }
    return out;
  }
  return node;
}

function windowText(raw) {
  if (!raw || !raw.window) return undefined;
  const { weekStart, weekEnd } = raw.window;
  if (weekStart == null) return undefined;
  return weekStart === weekEnd ? `第${weekStart}周` : `第${weekStart}-${weekEnd}周`;
}

function slotText(raw) {
  if (!raw || !raw.query) return undefined;
  const { weekday, periodStart, periodEnd } = raw.query;
  const parts = [];
  if (weekday != null) parts.push(`周${["一", "二", "三", "四", "五", "六", "日"][Number(weekday) - 1] || weekday}`);
  if (periodStart != null) parts.push(periodEnd != null ? `第${periodStart}-${periodEnd}节` : `第${periodStart}节`);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * 唯一入口：raw 工具结果 + Agent Tool 名 → { ok, errors, envelope }。
 * 未在映射表中的工具名返回错误（fail closed）。
 */
function project(raw, toolName) {
  const variant = resolveVariant(toolName);
  if (!variant) {
    return { ok: false, errors: [`未知 Agent Tool：${toolName}`], envelope: null };
  }
  switch (variant) {
    case "schedule": return projectSchedule(raw, toolName);
    case "space": return projectSpace(raw);
    case "collaboration": return projectCollaboration(raw);
    case "risk": return projectRisk(raw);
    case "reschedule": return projectReschedule(raw);
    case "ranking": return projectRanking(raw);
    case "overview": return projectOverview(raw);
    case "empty": return projectEmpty(raw);
    case "error": return projectError(raw);
    case "message": return projectMessage(raw);
    default: return { ok: false, errors: [`未实现 variant：${variant}`], envelope: null };
  }
}

module.exports = {
  MAP,
  resolveVariant,
  project,
  projectSchedule,
  projectSpace,
  projectCollaboration,
  projectRisk,
  projectReschedule,
  projectRanking,
  projectOverview,
  projectEmpty,
  projectError,
  projectMessage,
};
