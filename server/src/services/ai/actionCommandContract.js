// Action Command Contract（服务端守门员）
// 单一事实源: server/config/agent-capability-manifest.json 的 actions 段。
// 模型产出的顶层 actions 数组必须过这里校验后才能进入响应；
// confirmation !== "none" 的写操作只透传确认请求，服务端绝不执行。

const manifest = require("../../../config/agent-capability-manifest.json");
const generatedPayloadContract = require("./generatedPayloadContract");

const ACTION_CATALOG = manifest.actions || {};
const MAX_ACTIONS_PER_RESPONSE = 4;
const MAX_INPUT_STRING_LENGTH = 500;

function safeText(value, maxLength) {
  return generatedPayloadContract.safePrimitiveText(value, "", maxLength || 120);
}

function getActionDefinition(command) {
  return ACTION_CATALOG[String(command || "")] || null;
}

function isCommandKnown(command) {
  return Boolean(getActionDefinition(command));
}

function isCommandAllowedForRuntime(command, runtimeMode) {
  const definition = getActionDefinition(command);
  const mode = String(runtimeMode || "public");
  return Boolean(
    definition &&
    Array.isArray(definition.runtimeModes) &&
    definition.runtimeModes.includes(mode)
  );
}

function isAllowedPageUrl(url) {
  const raw = safeText(url, 240);
  if (!raw) return false;
  const pathOnly = raw.split("?")[0].split("#")[0];
  const allowed = new Set((ACTION_CATALOG.navigate && ACTION_CATALOG.navigate.allowedPages) || []);
  return Boolean(pathOnly && allowed.has(pathOnly));
}

function validateEnumValue(value, allowedValues) {
  return Array.isArray(allowedValues) && allowedValues.includes(value);
}

// 按 manifest inputSchema 做服务端侧最小校验（required / enum / 类型 / 长度）。
// 返回 { ok, reason }；reason 用于日志和调试，不回传给模型以外的通道。
function validateCommandInput(command, input) {
  const definition = getActionDefinition(command);
  if (!definition) return { ok: false, reason: "COMMAND_UNKNOWN" };
  const schema = definition.inputSchema && typeof definition.inputSchema === "object"
    ? definition.inputSchema
    : { type: "object", properties: {} };
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (value[key] === undefined || value[key] === null || value[key] === "") {
      return { ok: false, reason: `INPUT_MISSING_${key}` };
    }
  }
  const properties = schema.properties || {};
  for (const key of Object.keys(value)) {
    if (schema.additionalProperties === false && !Object.prototype.hasOwnProperty.call(properties, key)) {
      return { ok: false, reason: `INPUT_UNEXPECTED_${key}` };
    }
    const rule = properties[key];
    if (!rule) continue;
    const field = value[key];
    if (rule.type === "string" && typeof field !== "string") {
      return { ok: false, reason: `INPUT_TYPE_${key}` };
    }
    if (rule.type === "string" && rule.maxLength && String(field).length > rule.maxLength) {
      return { ok: false, reason: `INPUT_TOO_LONG_${key}` };
    }
    if (rule.enum && !rule.enum.includes(field)) {
      return { ok: false, reason: `INPUT_ENUM_${key}` };
    }
  }
  // 目标策略白名单（比 schema 更强约束，禁止任意跳转/任意面板/任意表单）
  if (command === "navigate" && !isAllowedPageUrl(value.url)) {
    return { ok: false, reason: "NAVIGATE_URL_NOT_WHITELISTED" };
  }
  if (command === "openSheet" && !validateEnumValue(value.sheet, definition.allowedSheets)) {
    return { ok: false, reason: "SHEET_NOT_WHITELISTED" };
  }
  if (command === "fillForm" && !validateEnumValue(value.form, definition.allowedForms)) {
    return { ok: false, reason: "FORM_NOT_WHITELISTED" };
  }
  return { ok: true, reason: "" };
}

function stableConfirmationRequest(raw, confirmationLevel) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!source) return null;
  const title = safeText(source.title, 60);
  const summary = safeText(source.summary || source.message, 240);
  if (!title || !summary) return null;
  const normalized = {
    title,
    summary,
    confirmText: safeText(source.confirmText, 20) || "确认",
    cancelText: safeText(source.cancelText, 20) || "取消",
    double: confirmationLevel === "double",
  };
  if (source.danger === true) normalized.danger = true;
  return normalized;
}

// 单条 Action Command 归一化；无效返回 null（降级丢弃，不中断响应）。
function stableActionCommand(raw, runtimeMode) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const command = safeText(source.command || source.id || source.type, 40);
  const definition = getActionDefinition(command);
  if (!definition) return null;
  if (!isCommandAllowedForRuntime(command, runtimeMode)) return null;
  const inputCheck = validateCommandInput(command, source.input || {});
  if (!inputCheck.ok) return null;
  const label = safeText(source.label, 30) || safeText(definition.displayName, 30) || command;
  const normalized = {
    command,
    label,
    input: sanitizeInput(source.input || {}),
    confirmation: definition.confirmation || "none",
  };
  if (definition.confirmation && definition.confirmation !== "none") {
    // 写操作只透传确认请求；缺少合法确认请求的命令直接丢弃，防止裸写指令下泄。
    const confirmationRequest = stableConfirmationRequest(source.confirmationRequest, definition.confirmation);
    if (!confirmationRequest) return null;
    normalized.confirmationRequest = confirmationRequest;
  }
  return normalized;
}

function sanitizeInput(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const output = {};
  Object.keys(source).slice(0, 12).forEach((key) => {
    const field = source[key];
    if (typeof field === "string") {
      output[key] = field.slice(0, MAX_INPUT_STRING_LENGTH);
    } else if (typeof field === "number" || typeof field === "boolean") {
      output[key] = field;
    } else if (field && typeof field === "object" && !Array.isArray(field)) {
      // 仅允许一层纯值对象（如 fillForm.fields / navigate.params）
      const nested = {};
      Object.keys(field).slice(0, 12).forEach((nestedKey) => {
        const nestedValue = field[nestedKey];
        if (typeof nestedValue === "string") nested[nestedKey] = nestedValue.slice(0, 240);
        else if (typeof nestedValue === "number" || typeof nestedValue === "boolean") nested[nestedKey] = nestedValue;
      });
      output[key] = nested;
    } else if (Array.isArray(field)) {
      output[key] = field.slice(0, 12).filter((item) => typeof item === "string").map((item) => item.slice(0, 120));
    }
  });
  return output;
}

function stableActionCommands(actions, runtimeMode) {
  if (!Array.isArray(actions)) return [];
  return actions
    .slice(0, MAX_ACTIONS_PER_RESPONSE)
    .map((item) => stableActionCommand(item, runtimeMode))
    .filter(Boolean);
}

module.exports = {
  ACTION_CATALOG,
  getActionDefinition,
  isAllowedPageUrl,
  isCommandAllowedForRuntime,
  isCommandKnown,
  stableActionCommand,
  stableActionCommands,
  validateCommandInput,
};
