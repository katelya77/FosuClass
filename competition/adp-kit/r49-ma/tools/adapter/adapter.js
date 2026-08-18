/**
 * R49-MA Agent Tool 适配层（CommonJS，零依赖）。
 *
 * 职责：
 * 1. 加载 tools/schemas/agent-tools.json 契约真源。
 * 2. 对 Agent Tool 请求做 schema 校验 + 确定性转换。
 * 3. 关键：campus_risk_check 的 self 模式 → 把 second=first 确定性复制，
 *    再调用 CampusTools compare_schedules，绝不要求模型提供第二对象。
 * 4. 组装 CampusTools REST 请求（POST {baseUrl}/api/<campusTool>）。
 *
 * 说明：本文件是可独立验证的契约层；真实 HTTP 调用由平台插件/CloudBase 承担。
 */

const fs = require("fs");
const path = require("path");

const CONTRACT_PATH = path.join(__dirname, "..", "schemas", "agent-tools.json");
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));

function findTool(name) {
  return CONTRACT.tools.find((t) => t.name === name) || null;
}

/** 简易 JSON Schema 校验（仅覆盖本项目契约用到的子集） */
function validateAgainstSchema(schema, value) {
  const errors = [];
  const props = schema.properties || {};
  const required = schema.required || [];

  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return ["输入必须是对象"];
  }

  for (const key of required) {
    if (value[key] === undefined || value[key] === null || value[key] === "") {
      errors.push(`缺少必填参数 ${key}`);
    }
  }

  // 条件必填（if/then）
  if (schema.if && schema.then) {
    const ifProps = schema.if.properties || {};
    const ifKey = Object.keys(ifProps)[0];
    const ifVal = ifProps[ifKey];
    let matched = false;
    if (ifVal.const !== undefined && value[ifKey] === ifVal.const) matched = true;
    if (ifVal.enum && ifVal.enum.includes(value[ifKey])) matched = true;
    if (matched) {
      for (const key of schema.then.required || []) {
        if (value[key] === undefined || value[key] === null || value[key] === "") {
          errors.push(`compare 模式缺少必填参数 ${key}`);
        }
      }
    }
  }

  for (const [key, prop] of Object.entries(props)) {
    if (value[key] === undefined || value[key] === null || value[key] === "") continue;
    if (prop.enum && !prop.enum.includes(value[key])) {
      errors.push(`${key} 取值非法，允许: ${prop.enum.join("/")}`);
    }
    if (prop.type === "integer") {
      if (!Number.isInteger(value[key])) {
        errors.push(`${key} 需为整数`);
      } else if (prop.minimum !== undefined && value[key] < prop.minimum) {
        errors.push(`${key} 不能小于 ${prop.minimum}`);
      } else if (prop.maximum !== undefined && value[key] > prop.maximum) {
        errors.push(`${key} 不能大于 ${prop.maximum}`);
      }
    }
    if (prop.pattern && typeof value[key] === "string" && !new RegExp(prop.pattern).test(value[key])) {
      errors.push(`${key} 格式非法（需 ${prop.pattern}）`);
    }
  }
  return errors;
}

const OMIT = Symbol("omit-optional");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSemanticallyEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

/**
 * R50.2A schema-aware 可选值归一化：可选字段的语义空值（null / undefined /
 * 空白字符串 / 空数组 / 空对象）在进入校验与映射前按「缺失」处理。
 * 必填字段与合法数值（含 0）绝不被删除；嵌套对象按子 schema 递归。
 */
function normalizeOptionalBySchema(schema, value, required) {
  if (!required && isSemanticallyEmpty(value)) return OMIT;
  if (schema && schema.type === "object" && isPlainObject(value)) {
    const props = schema.properties || {};
    const requiredKeys = new Set(schema.required || []);
    const out = { ...value };
    for (const [key, childSchema] of Object.entries(props)) {
      if (!Object.hasOwn(out, key)) continue;
      const child = normalizeOptionalBySchema(childSchema, out[key], requiredKeys.has(key));
      if (child === OMIT) delete out[key];
      else out[key] = child;
    }
    return out;
  }
  return value;
}

function normalizeAgentToolInput(schema, rawParams) {
  const input = isPlainObject(rawParams) ? { ...rawParams } : {};
  const normalized = normalizeOptionalBySchema(schema, input, true);
  return normalized === OMIT ? {} : normalized;
}

/**
 * 解析并规范化 Agent Tool 请求参数。
 * 返回 { ok: true, tool, params } 或 { ok: false, errors, tool, status: "clarification" }。
 */
function resolveAgentToolParams(name, rawParams) {
  const tool = findTool(name);
  if (!tool) return { ok: false, status: "error", errors: [`未知 Agent Tool: ${name}`] };

  const input = normalizeAgentToolInput(tool.inputSchema, rawParams);
  const errors = validateAgainstSchema(tool.inputSchema, input);
  if (errors.length) return { ok: false, status: "clarification", errors, tool };

  // R49.4/R50.0 跨字段校验：JSON Schema 的 minimum/maximum 无法表达 weekEnd >= weekStart。
  if (
    (name === "campus_teacher_load_query"
      || name === "campus_schedule_range_query"
      || name === "campus_room_utilization_query") &&
    Number.isInteger(input.weekStart) &&
    Number.isInteger(input.weekEnd) &&
    input.weekEnd < input.weekStart
  ) {
    return { ok: false, status: "clarification", errors: ["weekEnd 不得小于 weekStart"], tool };
  }

  // campus_risk_check：self 模式确定性复制 second=first
  if (name === "campus_risk_check") {
    const mode = input.mode === "compare" ? "compare" : "self";
    if (mode === "self") {
      input.secondEntityType = input.entityType;
      input.secondEntityName = input.entityName;
      delete input.mode; // 底层 compare_schedules 不接收 mode
    } else {
      delete input.mode;
    }
    return { ok: true, tool, params: input, mode };
  }

  return { ok: true, tool, params: input };
}

/**
 * 将 Agent Tool 参数映射到底层 CampusTools 参数（ADP Tool Wiring）。
 * 目前仅 campus_risk_check 需要映射：Agent Tool 层使用 entityType/entityName/
 * secondEntityType/secondEntityName，而 CampusTools compare_schedules 要求
 * firstType/firstName/secondType/secondName。其余 4 个工具字段名一致，原样透传。
 */
function mapAgentToolParams(name, params) {
  if (name !== "campus_risk_check") return params;
  const { entityType, entityName, secondEntityType, secondEntityName, ...rest } = params || {};
  return {
    firstType: entityType,
    firstName: entityName,
    secondType: secondEntityType,
    secondName: secondEntityName,
    ...rest,
  };
}

/**
 * 组装 CampusTools REST 请求。
 * @returns { url, method, headers, body }
 */
function buildRestRequest(name, params, opts) {
  const tool = findTool(name);
  if (!tool) throw new Error(`未知 Agent Tool: ${name}`);
  const baseUrl = (opts && opts.baseUrl) || "PLACEHOLDER_CAMPUS_API_BASE_URL";
  const token = (opts && opts.token) || "";
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = mapAgentToolParams(name, params);
  return {
    url: `${baseUrl}${tool.restPath}`,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  };
}

/** 失败关闭：无真实 Endpoint 时禁止猜测 */
function isFailClosed(opts) {
  const baseUrl = (opts && opts.baseUrl) || "";
  return !baseUrl || baseUrl.includes("PLACEHOLDER");
}

module.exports = {
  CONTRACT,
  findTool,
  resolveAgentToolParams,
  buildRestRequest,
  mapAgentToolParams,
  isFailClosed,
  validateAgainstSchema,
  normalizeAgentToolInput,
};
