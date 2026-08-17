"use strict";

const fs = require("node:fs");
const path = require("node:path");

const canonicalSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, "canonical-schema.json"), "utf8")
);

const KNOWN_NAMESPACES = canonicalSchema.properties.namespace.enum;

function fail(errors) {
  return { ok: false, errors };
}

/**
 * 校验规范化课表事件（与 canonical-schema.json 对齐的确定性实现）。
 * 拒绝：空 weeks、weekday ∉ 1..7、节次反向、confidence ∉ 0..1、未知 namespace、
 * 必填字段缺失、空教师/班级/课程名、空校区/教室。
 */
function validateCanonicalEvent(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return fail(["事件必须是对象"]);
  }

  const errors = [];
  const required = [
    "namespace", "semesterId", "course", "teachers", "classes",
    "location", "weekday", "periodStart", "periodEnd", "weeks", "source",
  ];
  for (const field of required) {
    if (!(field in event)) errors.push(`缺少必填字段 ${field}`);
  }
  if (errors.length > 0) return fail(errors);

  if (!KNOWN_NAMESPACES.includes(event.namespace)) {
    errors.push(`未知 namespace「${event.namespace}」，允许：${KNOWN_NAMESPACES.join(", ")}`);
  }
  if (typeof event.semesterId !== "string" || event.semesterId === "") {
    errors.push("semesterId 必须为非空字符串");
  }

  const course = event.course;
  if (course === null || typeof course !== "object" || typeof course.name !== "string" || course.name === "") {
    errors.push("course.name 必须为非空字符串");
  }
  if (!Array.isArray(event.teachers) || event.teachers.length === 0 || event.teachers.some((t) => typeof t !== "string" || t === "")) {
    errors.push("teachers 必须为非空字符串数组");
  }
  if (!Array.isArray(event.classes) || event.classes.length === 0 || event.classes.some((c) => typeof c !== "string" || c === "")) {
    errors.push("classes 必须为非空字符串数组");
  }

  const loc = event.location;
  if (loc === null || typeof loc !== "object" || typeof loc.campus !== "string" || loc.campus === "" || typeof loc.room !== "string" || loc.room === "") {
    errors.push("location.campus / location.room 必须为非空字符串");
  }

  if (!Number.isInteger(event.weekday) || event.weekday < 1 || event.weekday > 7) {
    errors.push(`weekday 必须为 1..7 整数，实际 ${event.weekday}`);
  }
  if (!Number.isInteger(event.periodStart) || !Number.isInteger(event.periodEnd) || event.periodStart < 1 || event.periodEnd < 1 || event.periodStart > 12 || event.periodEnd > 12) {
    errors.push("periodStart / periodEnd 必须为 1..12 整数");
  } else if (event.periodEnd < event.periodStart) {
    errors.push(`periodEnd(${event.periodEnd}) 不得小于 periodStart(${event.periodStart})`);
  }

  if (!Array.isArray(event.weeks) || event.weeks.length === 0) {
    errors.push("weeks 必须为非空数组（空周次表达非法）");
  } else {
    const seen = new Set();
    for (const w of event.weeks) {
      if (!Number.isInteger(w) || w < 1 || w > 20) {
        errors.push(`weeks 项必须为 1..20 整数，实际 ${w}`);
      } else if (seen.has(w)) {
        errors.push(`weeks 不得重复：${w}`);
      }
      seen.add(w);
    }
  }

  const src = event.source;
  if (src === null || typeof src !== "object") {
    errors.push("source 必须为对象");
  } else {
    if (typeof src.providerFamily !== "string" || src.providerFamily === "") errors.push("source.providerFamily 必须为非空字符串");
    if (typeof src.sourceType !== "string" || src.sourceType === "") errors.push("source.sourceType 必须为非空字符串");
    if (typeof src.importedAt !== "string" || src.importedAt === "") errors.push("source.importedAt 必须为非空字符串");
    if (typeof src.confidence !== "number" || src.confidence < 0 || src.confidence > 1) {
      errors.push(`source.confidence 必须位于 0..1，实际 ${src.confidence}`);
    }
  }

  return errors.length > 0 ? fail(errors) : { ok: true };
}

module.exports = { validateCanonicalEvent, KNOWN_NAMESPACES, canonicalSchema };