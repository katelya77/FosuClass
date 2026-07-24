// 小佛助手 Action Command Bus（小程序端执行器）
// 消费 miniprogram/shared/agentActionCatalog.generated.js（由 capability manifest 生成）。
// 安全原则：
//   1. 只执行 Catalog 中登记的 command；白名单外的 URL/面板/表单/场景一律拒绝。
//   2. confirmation !== "none" 的写操作：未收到 confirmed=true 绝不执行，只返回确认请求。
//   3. 所有输入在端上再校验一次（服务端校验 + 端上校验，双层防线）。

const catalog = require("../../shared/agentActionCatalog.generated.js");

const ACTION_CATALOG = catalog.ACTION_CATALOG || {};
const CARD_ACTION_TO_COMMAND = catalog.CARD_ACTION_TO_COMMAND || {};

function noop() {}

// context 由页面层提供，承载真正干活的 UI 能力：
//   openSheet(sheet) / fillComposer(text) / fillForm(form, fields)
//   confirmWrite(input, confirmationRequest) / retry(taskId)
//   resolveSubscribeTemplateIds(scene) → string[]
//   onExecuted(result) / onRejected(result)
function createActionBus(options = {}) {
  const wxApi = options.wx || (typeof wx !== "undefined" ? wx : null);
  const context = options.context || {};

  function getAction(id) {
    return ACTION_CATALOG[String(id || "")] || null;
  }

  function isAllowedPageUrl(url) {
    const raw = String(url || "");
    if (!raw) return false;
    const pathOnly = raw.split("?")[0].split("#")[0];
    const allowed = (ACTION_CATALOG.navigate && ACTION_CATALOG.navigate.allowedPages) || [];
    return Boolean(pathOnly && allowed.includes(pathOnly));
  }

  function isTabPage(url) {
    const pathOnly = String(url || "").split("?")[0].split("#")[0];
    const tabPages = (ACTION_CATALOG.navigate && ACTION_CATALOG.navigate.tabPages) || [];
    return tabPages.includes(pathOnly);
  }

  function buildUrl(url, params) {
    const base = String(url || "");
    const source = params && typeof params === "object" && !Array.isArray(params) ? params : {};
    const query = Object.keys(source)
      .filter((key) => typeof source[key] === "string" && source[key])
      .slice(0, 8)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(source[key])}`)
      .join("&");
    return query ? `${base}?${query}` : base;
  }

  // 端上输入校验（与服务端 actionCommandContract 规则保持一致，取最小集）
  function validateInput(id, definition, input) {
    const schema = definition.inputSchema || { properties: {} };
    const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (value[key] === undefined || value[key] === null || value[key] === "") {
        return { ok: false, reason: `INPUT_MISSING_${key}` };
      }
    }
    const properties = schema.properties || {};
    for (const key of Object.keys(value)) {
      const rule = properties[key];
      if (!rule) {
        if (schema.additionalProperties === false) return { ok: false, reason: `INPUT_UNEXPECTED_${key}` };
        continue;
      }
      const field = value[key];
      if (rule.type === "string" && typeof field !== "string") return { ok: false, reason: `INPUT_TYPE_${key}` };
      if (rule.type === "string" && rule.maxLength && String(field).length > rule.maxLength) {
        return { ok: false, reason: `INPUT_TOO_LONG_${key}` };
      }
      if (rule.enum && !rule.enum.includes(field)) return { ok: false, reason: `INPUT_ENUM_${key}` };
    }
    if (id === "navigate" && !isAllowedPageUrl(value.url)) {
      return { ok: false, reason: "NAVIGATE_URL_NOT_WHITELISTED" };
    }
    if (id === "openSheet" && !(definition.allowedSheets || []).includes(value.sheet)) {
      return { ok: false, reason: "SHEET_NOT_WHITELISTED" };
    }
    if (id === "fillForm" && !(definition.allowedForms || []).includes(value.form)) {
      return { ok: false, reason: "FORM_NOT_WHITELISTED" };
    }
    if (id === "requestSubscribe" && !(definition.allowedScenes || []).includes(value.scene)) {
      return { ok: false, reason: "SCENE_NOT_WHITELISTED" };
    }
    return { ok: true, reason: "" };
  }

  function reject(command, reason) {
    const result = { executed: false, rejected: true, command: command || "", reason };
    if (typeof context.onRejected === "function") context.onRejected(result);
    return result;
  }

  function done(command, handler) {
    const result = { executed: true, rejected: false, command, handler };
    if (typeof context.onExecuted === "function") context.onExecuted(result);
    return result;
  }

  // 卡片按钮 → command 归一化；ask/noop 等协议层特殊类型返回 null（由页面层处理）
  function resolveCardAction(cardActionType) {
    if (!Object.prototype.hasOwnProperty.call(CARD_ACTION_TO_COMMAND, cardActionType)) return null;
    return CARD_ACTION_TO_COMMAND[cardActionType];
  }

  // 执行一条 Action Command。
  // payload: { command, label, input, confirmation, confirmationRequest }
  // execOptions: { runtimeMode, confirmed }
  function execute(payload, execOptions = {}) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const id = String(source.command || source.id || source.type || "");
    const definition = getAction(id);
    if (!definition) return reject(id, "COMMAND_UNKNOWN");

    const runtimeMode = String(execOptions.runtimeMode || "public");
    if (Array.isArray(definition.runtimeModes) && !definition.runtimeModes.includes(runtimeMode)) {
      return reject(id, "RUNTIME_NOT_ALLOWED");
    }

    const input = source.input && typeof source.input === "object" && !Array.isArray(source.input)
      ? source.input
      : {};
    const inputCheck = validateInput(id, definition, input);
    if (!inputCheck.ok) return reject(id, inputCheck.reason);

    const confirmation = definition.confirmation || "none";
    if (confirmation !== "none" && execOptions.confirmed !== true) {
      // 写操作未确认：绝不执行，返回确认请求交给 UI 弹卡。
      return {
        executed: false,
        rejected: false,
        confirmationRequired: true,
        command: id,
        confirmation: confirmation === "double" ? "double" : "required",
        confirmationRequest: source.confirmationRequest || null,
      };
    }

    switch (id) {
      case "navigate": {
        if (!wxApi) return reject(id, "WX_UNAVAILABLE");
        const url = buildUrl(input.url, input.params);
        if (isTabPage(input.url) && typeof wxApi.switchTab === "function") {
          // tabBar 页面必须走 switchTab，且 switchTab 不允许携带 query；
          // query 的交接（如 pending query）由页面层可选钩子处理。
          if (typeof context.storeTabPendingQuery === "function") {
            context.storeTabPendingQuery(String(input.url));
          }
          wxApi.switchTab({ url: String(input.url).split("?")[0], fail: noop });
        } else if (typeof wxApi.navigateTo === "function") {
          wxApi.navigateTo({ url, fail: noop });
        } else {
          return reject(id, "WX_UNAVAILABLE");
        }
        return done(id, isTabPage(input.url) ? "switchTab" : "navigateTo");
      }
      case "openSheet": {
        if (typeof context.openSheet !== "function") return reject(id, "CONTEXT_HANDLER_MISSING");
        context.openSheet(String(input.sheet));
        return done(id, "openSheet");
      }
      case "fillComposer": {
        if (typeof context.fillComposer !== "function") return reject(id, "CONTEXT_HANDLER_MISSING");
        context.fillComposer(String(input.text));
        return done(id, "fillComposer");
      }
      case "fillForm": {
        if (typeof context.fillForm !== "function") return reject(id, "CONTEXT_HANDLER_MISSING");
        context.fillForm(String(input.form), input.fields || {});
        return done(id, "fillForm");
      }
      case "requestSubscribe": {
        if (!wxApi || typeof wxApi.requestSubscribeMessage !== "function") return reject(id, "WX_UNAVAILABLE");
        const resolve = context.resolveSubscribeTemplateIds;
        const tmplIds = typeof resolve === "function" ? resolve(String(input.scene)) : [];
        if (!Array.isArray(tmplIds) || !tmplIds.length) return reject(id, "TEMPLATE_IDS_MISSING");
        wxApi.requestSubscribeMessage({ tmplIds: tmplIds.slice(0, 3), complete: noop });
        return done(id, "requestSubscribeMessage");
      }
      case "confirmWrite": {
        // 到达此处说明 confirmed === true：由页面层执行真实写入。
        if (typeof context.confirmWrite !== "function") return reject(id, "CONTEXT_HANDLER_MISSING");
        context.confirmWrite(input, source.confirmationRequest || null);
        return done(id, "confirmWrite");
      }
      case "copy": {
        if (!wxApi || typeof wxApi.setClipboardData !== "function") return reject(id, "WX_UNAVAILABLE");
        wxApi.setClipboardData({ data: String(input.text), fail: noop });
        return done(id, "setClipboardData");
      }
      case "retry": {
        if (typeof context.retry !== "function") return reject(id, "CONTEXT_HANDLER_MISSING");
        context.retry(String(input.taskId));
        return done(id, "retry");
      }
      default:
        return reject(id, "HANDLER_NOT_IMPLEMENTED");
    }
  }

  return {
    ACTION_CATALOG,
    CARD_ACTION_TO_COMMAND,
    execute,
    getAction,
    isAllowedPageUrl,
    resolveCardAction,
    validateInput,
  };
}

module.exports = { createActionBus };
