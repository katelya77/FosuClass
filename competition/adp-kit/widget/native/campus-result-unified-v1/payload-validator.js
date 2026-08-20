"use strict";
// CSF P1.6 WidgetPayloadValidator —— 唯一入口：校验所有 Agent 最终输出的 Widget payload，
// 与 widget/native/campus-result-unified-v1/schema.json（fosuclass-adp-widget-contract/v8）同一 schema。
//
// fail-closed：校验失败时输出可读中文文本 fallback（标题 / 副标题 / 摘要 / 上下文 / 区块行 /
// 展示元数据），绝不输出原始 JSON 或内部协议字段。业务事实保留在 fallback 中。
//
// 规则要点：
//  - version 只接受固定 "1.0"（模型生成任何研发版本号一律拒绝；版本号由确定性投影注入）；
//  - actions 仅允许 type=sys.chat，payload 仅 { query }；open_widget / broaden_query / 其它透传拒绝；
//  - displayMeta.tieGroupCount 无并列时缺省；出现时必须为 ≥1 的整数；
//  - layoutMode=week-board：days 每项 blocks 必须 ≥1（空日由确定性投影过滤，Widget 永不收到空日）；
//  - 未知字段（含 queryId / dataHash / sourceTool / rankContext / temporalContext / token /
//    authorization 等内部协议键）拒绝。
const fs = require("fs");
const path = require("path");

const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "schema.json"), "utf8")
);

const VARIANTS = new Set(SCHEMA.properties.variant.enum);
const STATUSES = new Set(SCHEMA.properties.status.enum);
const LAYOUTS = new Set(SCHEMA.properties.layoutMode.enum);
const SECTION_KINDS = new Set(SCHEMA.properties.sections.items.properties.kind.enum);
const REQUIRED = SCHEMA.required.slice();

const ALLOWED_ACTION_TYPES = new Set(["sys.chat"]);
const FORBIDDEN_FIELD_PATTERNS = [
  "queryid", "datahash", "dataversion", "sourcetool", "rankcontext", "temporalcontext",
  "nodeid", "varbizid", "authorization", "token", "secret", "credential", "password",
  "evidence", "computedat", "internalurl",
];

const TEXT_FALLBACK_DEFAULT = "结果暂时无法以卡片展示。请用文字描述你的需求，我重新为你查询。";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnexpectedKeys(object, allowed, trail, errors) {
  if (!isPlainObject(object)) return;
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) errors.push(`${trail} 含未知字段 ${key}`);
  }
}

function findForbiddenKeys(node, trail, violations) {
  if (!isPlainObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const lower = String(key).toLowerCase();
    if (FORBIDDEN_FIELD_PATTERNS.some((pattern) => lower.includes(pattern))) {
      violations.push(trail ? `${trail}.${key}` : key);
    }
    if (isPlainObject(value)) findForbiddenKeys(value, trail ? `${trail}.${key}` : key, violations);
    else if (Array.isArray(value)) {
      for (const item of value) findForbiddenKeys(item, trail ? `${trail}.${key}` : key, violations);
    }
  }
}

function validateWidgetPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ["payload 必须是对象"], textFallback: TEXT_FALLBACK_DEFAULT };
  }
  const errors = [];
  rejectUnexpectedKeys(payload, new Set(Object.keys(SCHEMA.properties)), "payload", errors);

  for (const field of REQUIRED) {
    if (!Object.hasOwn(payload, field)) errors.push(`缺少必填字段 ${field}`);
  }

  if (Object.hasOwn(payload, "version") && payload.version !== "1.0") {
    errors.push(`version 必须为固定 1.0（实际 ${JSON.stringify(payload.version)}）；版本号由系统注入，不接收模型生成的研发版本号`);
  }
  if (Object.hasOwn(payload, "variant") && !VARIANTS.has(payload.variant)) {
    errors.push(`未知 variant：${JSON.stringify(payload.variant)}`);
  }
  if (Object.hasOwn(payload, "status") && !STATUSES.has(payload.status)) {
    errors.push(`未知 status：${JSON.stringify(payload.status)}`);
  }
  if (Object.hasOwn(payload, "layoutMode") && !LAYOUTS.has(payload.layoutMode)) {
    errors.push(`未知 layoutMode：${JSON.stringify(payload.layoutMode)}`);
  }
  if (Object.hasOwn(payload, "title") && typeof payload.title === "string" && !payload.title.length) {
    errors.push("title 不能为空");
  }
  if (Object.hasOwn(payload, "summary") && typeof payload.summary === "string" && !payload.summary.length) {
    errors.push("summary 不能为空");
  }
  if (Object.hasOwn(payload, "verified") && typeof payload.verified !== "boolean") {
    errors.push("verified 必须是布尔值");
  }

  if (Array.isArray(payload.sections)) {
    for (const [index, section] of payload.sections.entries()) {
      if (!isPlainObject(section) || !section.title || !Array.isArray(section.rows)) {
        errors.push(`sections[${index}] 必须含 title 与 rows 数组`);
        continue;
      }
      rejectUnexpectedKeys(section, new Set(["title", "kind", "note", "rows"]), `sections[${index}]`, errors);
      if (section.kind !== undefined && !SECTION_KINDS.has(section.kind)) {
        errors.push(`sections[${index}].kind 非法：${JSON.stringify(section.kind)}`);
      }
      for (const [rowIndex, row] of section.rows.entries()) {
        if (!isPlainObject(row) || !row.label || !row.value) {
          errors.push(`sections[${index}].rows[${rowIndex}] 必须含 label 与 value`);
        }
        rejectUnexpectedKeys(row, new Set(["label", "value", "badge", "hint"]), `sections[${index}].rows[${rowIndex}]`, errors);
      }
    }
  } else if (payload.sections !== undefined) {
    errors.push("sections 必须是数组");
  }

  if (Array.isArray(payload.actions)) {
    for (const [index, action] of payload.actions.entries()) {
      if (!isPlainObject(action)) {
        errors.push(`actions[${index}] 必须是对象`);
        continue;
      }
      rejectUnexpectedKeys(action, new Set(["id", "type", "label", "payload"]), `actions[${index}]`, errors);
      if (!ALLOWED_ACTION_TYPES.has(action.type)) {
        errors.push(`actions[${index}].type 仅允许 sys.chat（实际 ${JSON.stringify(action.type)}）；open_widget / broaden_query 等透传一律拒绝`);
      }
      if (!action.label || typeof action.label !== "string" || !action.label.length) {
        errors.push(`actions[${index}] 缺少 label`);
      }
      if (!isPlainObject(action.payload) || typeof action.payload.query !== "string" || !action.payload.query.length) {
        errors.push(`actions[${index}].payload 必须为 { query } 自然语言`);
      } else {
        for (const key of Object.keys(action.payload)) {
          if (key !== "query") errors.push(`actions[${index}].payload 仅允许 query 字段（含 ${key}）`);
        }
      }
    }
  } else if (payload.actions !== undefined) {
    errors.push("actions 必须是数组");
  }

  if (payload.displayMeta !== undefined) {
    if (!isPlainObject(payload.displayMeta)) {
      errors.push("displayMeta 必须是对象");
    } else {
      rejectUnexpectedKeys(payload.displayMeta, new Set(["simulated", "weekendMarked", "tieNote", "tieGroupCount", "recoverable"]), "displayMeta", errors);
      if (payload.displayMeta.tieGroupCount !== undefined) {
        const n = payload.displayMeta.tieGroupCount;
        if (!Number.isInteger(n) || n < 1) {
          errors.push(`displayMeta.tieGroupCount 出现时必须为 ≥1 的整数（实际 ${JSON.stringify(n)}）`);
        }
      }
    }
  }

  if (payload.layoutMode === "week-board") {
    if (typeof payload.weekBoardTitle !== "string" || !payload.weekBoardTitle.length) {
      errors.push("week-board 缺少 weekBoardTitle");
    }
    if (typeof payload.weekBoardSubtitle !== "string" || !payload.weekBoardSubtitle.length) {
      errors.push("week-board 缺少 weekBoardSubtitle");
    }
    if (!Array.isArray(payload.days) || payload.days.length === 0) {
      errors.push("week-board 必须含非空 days");
    } else {
      for (const [index, day] of payload.days.entries()) {
        if (!isPlainObject(day) || typeof day.label !== "string" || !day.label.length) {
          errors.push(`days[${index}] 缺少 label`);
        }
        rejectUnexpectedKeys(day, new Set(["label", "blocks"]), `days[${index}]`, errors);
        if (!Array.isArray(day.blocks) || day.blocks.length === 0) {
          errors.push(`days[${index}].blocks 不能为空（空日由确定性投影过滤，Widget 不接收空日）`);
        } else {
          for (const [blockIndex, block] of day.blocks.entries()) {
            if (!isPlainObject(block) || !block.time || !block.title || !block.location) {
              errors.push(`days[${index}].blocks[${blockIndex}] 必须含 time / title / location`);
            }
            rejectUnexpectedKeys(block, new Set(["time", "title", "location", "meta"]), `days[${index}].blocks[${blockIndex}]`, errors);
          }
        }
      }
    }
  } else if (payload.layoutMode === "result-card") {
    if (payload.days !== undefined && !Array.isArray(payload.days)) {
      errors.push("result-card 的 days 必须是数组");
    }
  }

  const forbidden = [];
  findForbiddenKeys(payload, "", forbidden);
  if (forbidden.length) {
    errors.push(`内部协议字段泄漏：${forbidden.join(",")}`);
  }

  if (errors.length) {
    return { ok: false, errors, textFallback: buildTextFallback(payload) };
  }
  return { ok: true, errors: [], textFallback: "" };
}

function buildTextFallback(payload) {
  if (!isPlainObject(payload)) return TEXT_FALLBACK_DEFAULT;
  const lines = [];
  if (payload.title) lines.push(payload.title);
  if (payload.subtitle) lines.push(payload.subtitle);
  if (payload.verified !== undefined) lines.push(payload.verified ? "已核验" : "未核验");
  if (payload.summary) lines.push(payload.summary);
  if (payload.context) lines.push(payload.context);
  if (payload.displayMeta && payload.displayMeta.simulated) lines.push("（模拟结果，未执行任何修改）");
  if (payload.displayMeta && payload.displayMeta.tieNote) lines.push(payload.displayMeta.tieNote);
  if (Array.isArray(payload.sections)) {
    for (const section of payload.sections) {
      if (!isPlainObject(section)) continue;
      if (section.title) lines.push(section.title);
      if (Array.isArray(section.rows)) {
        for (const row of section.rows) {
          if (!isPlainObject(row)) continue;
          const badge = row.badge ? `（${row.badge}）` : "";
          const hint = row.hint ? ` · ${row.hint}` : "";
          lines.push(`${row.label}：${row.value}${badge}${hint}`);
        }
      }
      if (section.note) lines.push(section.note);
    }
  }
  return lines.length ? lines.join("\n") : TEXT_FALLBACK_DEFAULT;
}

module.exports = { validateWidgetPayload, buildTextFallback, REQUIRED, VARIANTS, STATUSES, LAYOUTS, SECTION_KINDS };
