"use strict";
// R50.2B CampusResultEnvelope 规范化 / 校验 / 泄漏守卫（2026-08-19）
//
// 职责：
//  - validateEnvelope(obj)   ：按 canonical schema 校验（variant/status 白名单、必填公开字段、
//                              非法组合、未知键拒绝）。
//  - sanitizeEnvelope(obj)   ：移除内部元数据键与含内部协议的字段（只删除，绝不改写/编造校园事实），
//                              输出 deterministic。
//  - isClean(obj)            ：键名 + 序列化值两级泄漏扫描。
//  - normalizeEnvelope(obj)  ：默认值补齐（subtitle/context/sections/actions/displayMeta）+ sanitize + 校验。
//
// 不泄漏：queryId / dataHash / sourceTool / rankContext / temporalContext / NodeID /
// VarBizID / token / authorization / secret / 内部 URL / 原始内部协议。
const fs = require("fs");
const path = require("path");

const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "campus-result-envelope.schema.json"), "utf8")
);

const VARIANTS = new Set(SCHEMA.properties.variant.enum);
const STATUSES = new Set(SCHEMA.properties.status.enum);
const SECTION_KINDS = new Set(SCHEMA.properties.sections.items.properties.kind.enum);
// Agent-facing Envelope 不含 version：研发版本号由确定性投影层注入，模型不生成版本号。
// 若出现 version，仅接受固定 "1.0"。
const REQUIRED = ["variant", "status", "title", "verified", "summary"];

// status 与 variant 的合法组合：success 仅富结果；empty 仅 empty；error 仅 error。
const STATUS_OF_VARIANT = {
  schedule: "success",
  space: "success",
  collaboration: "success",
  risk: "success",
  reschedule: "success",
  ranking: "success",
  overview: "success",
  empty: "empty",
  error: "error",
  message: "success",
};

// 内部协议键（大小写不敏感子串匹配）。
const FORBIDDEN_KEY_PATTERNS = [
  "queryid",
  "datahash",
  "dataversion",
  "sourcetool",
  "rankcontext",
  "temporalcontext",
  "nodeid",
  "varbizid",
  "authorization",
  "token",
  "secret",
  "credential",
  "password",
  "evidence",
  "computedat",
  "internalurl",
];

// 内部协议值（序列化后大小写不敏感扫描）。
const FORBIDDEN_VALUE_PATTERNS = [
  /queryid[:=\s]/i,
  /datahash[:=\s]/i,
  /sourcetool[:=\s]/i,
  /rankcontext/i,
  /temporalcontext/i,
  /nodeid[\s:=]/i,
  /varbizid[\s:=]/i,
  /authorization[\s:=]/i,
  /bearer\s+[a-z0-9._~+/=-]+/i,
  /sk-[a-z0-9._-]*\d[a-z0-9._-]*/i,
  /q-\d{6,10}-[a-z0-9-]+/i,
  /https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|internal\.|[\w-]+\.internal)/i,
  /https?:\/\/[^\s"']*\/api\//i,
];

function findLeakKeys(obj, trail) {
  const violations = [];
  for (const [key, value] of Object.entries(obj)) {
    const lower = String(key).toLowerCase();
    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => lower.includes(pattern))) {
      violations.push({ field: trail ? `${trail}.${key}` : key, kind: "key", key });
      continue;
    }
    if (value !== null && typeof value === "object") {
      violations.push(...findLeakKeys(value, trail ? `${trail}.${key}` : key));
    }
  }
  return violations;
}

function findLeakValues(obj) {
  const violations = [];
  const serialized = JSON.stringify(obj);
  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(serialized)) {
      violations.push({ field: null, kind: "value", pattern: pattern.source });
    }
  }
  return violations;
}

function isClean(obj) {
  const violations = [...findLeakKeys(obj), ...findLeakValues(obj)];
  return { ok: violations.length === 0, violations };
}

function validateEnvelope(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: ["envelope 必须是对象"] };
  }
  const errors = [];
  for (const field of REQUIRED) {
    if (!Object.hasOwn(obj, field) || obj[field] === undefined) {
      errors.push(`缺少必填字段 ${field}`);
    }
  }
  if (Object.hasOwn(obj, "version") && obj.version !== "1.0") {
    errors.push(`version 必须为 1.0（实际 ${JSON.stringify(obj.version)}）`);
  }
  if (Object.hasOwn(obj, "variant") && !VARIANTS.has(obj.variant)) {
    errors.push(`未知 variant：${JSON.stringify(obj.variant)}`);
  }
  if (Object.hasOwn(obj, "status") && !STATUSES.has(obj.status)) {
    errors.push(`未知 status：${JSON.stringify(obj.status)}`);
  }
  if (!errors.length) {
    const expected = STATUS_OF_VARIANT[obj.variant];
    if (obj.status !== expected) {
      errors.push(`variant=${obj.variant} 要求 status=${expected}（实际 ${obj.status}）`);
    }
    if (obj.variant !== "error" && obj.verified !== true) {
      errors.push(`verified=false 仅允许 error 变体（variant=${obj.variant}）`);
    }
    if (obj.variant === "error" && obj.verified !== false) {
      errors.push(`error 变体必须 verified=false`);
    }
  }
  // 未知键（schema additionalProperties=false 的 JS 侧等价实现）
  const schemaKeys = new Set([
    "version", "variant", "status", "title", "subtitle", "verified",
    "summary", "context", "sections", "actions", "displayMeta",
  ]);
  for (const key of Object.keys(obj)) {
    if (!schemaKeys.has(key)) errors.push(`未知字段 ${key}`);
  }
  if (Array.isArray(obj.sections)) {
    for (const [index, section] of obj.sections.entries()) {
      if (!section || typeof section !== "object" || !section.title || !Array.isArray(section.rows)) {
        errors.push(`sections[${index}] 必须含 title 与 rows 数组`);
      } else {
        const sectionKeys = new Set(["title", "kind", "note", "rows"]);
        for (const key of Object.keys(section)) {
          if (!sectionKeys.has(key)) errors.push(`sections[${index}] 含未知字段 ${key}`);
        }
        if (section.kind !== undefined && !SECTION_KINDS.has(section.kind)) {
          errors.push(`sections[${index}].kind 非法：${JSON.stringify(section.kind)}`);
        }
        for (const [rowIndex, row] of section.rows.entries()) {
          if (!row || !row.label || !row.value) {
            errors.push(`sections[${index}].rows[${rowIndex}] 必须含 label 与 value`);
            continue;
          }
          const rowKeys = new Set(["label", "value", "badge", "hint"]);
          for (const key of Object.keys(row)) {
            if (!rowKeys.has(key)) errors.push(`sections[${index}].rows[${rowIndex}] 含未知字段 ${key}`);
          }
        }
      }
    }
  }
  if (Array.isArray(obj.actions)) {
    for (const [index, action] of obj.actions.entries()) {
      if (!action || action.type !== "sys.chat" || !action.label || !action.payload || !action.payload.query) {
        errors.push(`actions[${index}] 必须为 { type:"sys.chat", label, payload:{query} }`);
      }
    }
  }
  if (obj.displayMeta !== undefined && (obj.displayMeta === null || typeof obj.displayMeta !== "object" || Array.isArray(obj.displayMeta))) {
    errors.push("displayMeta 必须是对象");
  }
  return { ok: errors.length === 0, errors };
}

function dropLeakyNode(node) {
  if (Array.isArray(node)) {
    const out = [];
    for (const item of node) {
      const cleaned = dropLeakyNode(item);
      if (cleaned !== null) out.push(cleaned);
    }
    return out;
  }
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const lower = String(key).toLowerCase();
      if (FORBIDDEN_KEY_PATTERNS.some((pattern) => lower.includes(pattern))) continue;
      if (value !== null && typeof value === "object") {
        out[key] = dropLeakyNode(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
  return node;
}

function sanitizeEnvelope(obj) {
  const sanitized = dropLeakyNode(obj);
  const serialized = JSON.stringify(sanitized);
  const out = JSON.parse(serialized);
  // 值级扫描：含内部协议值的字段整字段移除（只删除，不改写事实）。
  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (!pattern.test(serialized)) continue;
    const reserialized = JSON.stringify(out);
    if (!pattern.test(reserialized)) continue;
    stripValuesMatching(out, pattern);
  }
  return out;
}

function stripValuesMatching(node, pattern) {
  if (Array.isArray(node)) {
    for (let index = node.length - 1; index >= 0; index--) {
      const item = node[index];
      if (item !== null && typeof item === "object") {
        stripValuesMatching(item, pattern);
      } else if (typeof item === "string" && pattern.test(item)) {
        node.splice(index, 1);
      }
    }
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value !== null && typeof value === "object") {
        stripValuesMatching(value, pattern);
      } else if (typeof value === "string" && pattern.test(value)) {
        delete node[key];
      }
    }
  }
}

function normalizeEnvelope(raw) {
  const withDefaults = {
    subtitle: "",
    context: "",
    sections: [],
    actions: [],
    displayMeta: {},
    ...dropLeakyNode(raw),
  };
  const sanitized = sanitizeEnvelope(withDefaults);
  const result = validateEnvelope(sanitized);
  if (!result.ok) {
    return { ok: false, errors: result.errors, envelope: null };
  }
  return { ok: true, errors: [], envelope: sanitized };
}

module.exports = {
  SCHEMA,
  VARIANTS,
  STATUSES,
  SECTION_KINDS,
  REQUIRED,
  STATUS_OF_VARIANT,
  isClean,
  validateEnvelope,
  sanitizeEnvelope,
  normalizeEnvelope,
};
