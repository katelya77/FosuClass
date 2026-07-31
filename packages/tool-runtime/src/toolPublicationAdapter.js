// P4b：Tool 域发布适配器（Config Kernel 域协议，热发布 Tool 可用性策略）。
//
// 发布物是纯声明式 overlay，只能「禁用 / 收窄」静态插件工具，永远不能新增
// 可执行行为或扩大授权：
//   { tools: [{ id, enabled?, runtimeModes? }] }
//
// 安全不变量：
// - id 必须 ∈ 服务器注入的静态工具集（插件描述符）；payload 不携带 execute。
// - runtimeModes ⊆ 静态描述符自身集合（静态空集 = 全模式，允许三元组子集）；
//   只能收窄，不能加宽。
// - safety 元数据（autonomyLevel/requiresConfirmation/operation）不可经发布修改，
//   白名单字段之外一律拒绝。
// - 省略的工具 = 继承静态默认（启用 + 静态模式）；空 overlay（{tools: []}）合法，
//   语义 = 全部静态默认（种子 ≡ P4b 前行为）。
// - 执行仍走 toolRuntime 五因子交集与 Guardrail；本 overlay 只作用于
//   runtimeToolIds 因子（收窄方向）。

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const RUNTIME_MODES = Object.freeze(["public", "trial", "dev"]);
const ENTRY_FIELDS = Object.freeze(["id", "enabled", "runtimeModes"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function createToolPublicationAdapter(options = {}) {
  // staticTools: 插件工具公开描述符（id/runtimeModes），由服务器从 toolRuntime 注入。
  const staticTools = Array.isArray(options.staticTools) ? options.staticTools : [];
  if (!staticTools.length) throw codedError("TOOL_PUBLICATION_STATIC_REQUIRED", "static tool descriptors are required");
  const staticById = new Map(staticTools.map((tool) => [tool.id, tool]));

  function validate(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errors: ["payload must be a plain object"] };
    }
    Object.keys(payload).forEach((field) => {
      if (field !== "tools") errors.push(`${field} is not a declarative field`);
    });
    const tools = payload.tools;
    if (tools !== undefined && !Array.isArray(tools)) {
      errors.push("tools must be an array");
    }
    if (Array.isArray(tools) && tools.length > 256) errors.push("tools exceeds 256 entries");
    const seen = new Set();
    const normalizedTools = [];
    (Array.isArray(tools) ? tools : []).forEach((item, index) => {
      const where = `tools[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${where} must be a plain object`);
        return;
      }
      Object.keys(item).forEach((field) => {
        if (!ENTRY_FIELDS.includes(field)) errors.push(`${where}.${field} is not a declarative field`);
      });
      const id = safeString(item.id, 128);
      if (!TOOL_ID_PATTERN.test(id)) {
        errors.push(`${where}.id is invalid`);
        return;
      }
      if (seen.has(id)) {
        errors.push(`${where}.id is duplicated: ${id}`);
        return;
      }
      seen.add(id);
      const staticTool = staticById.get(id);
      if (!staticTool) {
        errors.push(`${where}.id is not present in the plugin static tool set: ${id}`);
        return;
      }
      const staticModes = Array.isArray(staticTool.runtimeModes) ? staticTool.runtimeModes : [];
      const allowedModeSet = new Set(staticModes.length ? staticModes : RUNTIME_MODES);
      let modes;
      if (item.runtimeModes !== undefined) {
        if (!Array.isArray(item.runtimeModes)) {
          errors.push(`${where}.runtimeModes must be an array`);
        } else if (!item.runtimeModes.length) {
          // 空数组在下游「!modes.length = 全模式」语义下会把收窄变加宽
          // （审查 Important #1 实测破口）：省略 = 继承静态；非空 = 收窄。
          errors.push(`${where}.runtimeModes must not be an empty array (omit to inherit static modes)`);
        } else {
          modes = [];
          item.runtimeModes.forEach((mode) => {
            const text = safeString(mode, 24);
            if (!allowedModeSet.has(text)) {
              errors.push(`${where}.runtimeModes entry is outside the static tool set: ${text}`);
              return;
            }
            if (!modes.includes(text)) modes.push(text);
          });
        }
      }
      if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
        errors.push(`${where}.enabled must be a boolean`);
      }
      const entry = { id };
      if (item.enabled !== undefined) entry.enabled = item.enabled !== false;
      if (modes) entry.runtimeModes = modes;
      normalizedTools.push(entry);
    });
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized: { tools: normalizedTools } };
  }

  function resolveRuntime(versionDoc) {
    if (!versionDoc || !versionDoc.payload) throw codedError("TOOL_PUBLICATION_VERSION_REQUIRED");
    const validation = validate(versionDoc.payload);
    if (!validation.ok) {
      throw codedError("TOOL_PUBLICATION_VERSION_INVALID", validation.errors.join("; ").slice(0, 240));
    }
    const disabled = [];
    const modeOverrides = {};
    (validation.normalized.tools || []).forEach((entry) => {
      if (entry.enabled === false) disabled.push(entry.id);
      if (Array.isArray(entry.runtimeModes)) modeOverrides[entry.id] = entry.runtimeModes.slice();
    });
    return Object.freeze({
      disabled: Object.freeze(disabled),
      modeOverrides: Object.freeze(JSON.parse(JSON.stringify(modeOverrides))),
    });
  }

  return Object.freeze({
    domain: "tool",

    validate,

    test(normalized) {
      const overlay = normalized || {};
      const tools = Array.isArray(overlay.tools) ? overlay.tools : [];
      const disabledCount = tools.filter((entry) => entry.enabled === false).length;
      // 发布前测试：不得禁用全部工具（确定性路径必须有可用工具集兜底）。
      if (disabledCount >= staticById.size) {
        return { ok: false, results: { reason: "publication would disable every static tool" } };
      }
      return {
        ok: true,
        results: {
          overlayEntries: tools.length,
          disabled: disabledCount,
          modeOverrides: tools.filter((entry) => Array.isArray(entry.runtimeModes)).length,
          staticToolCount: staticById.size,
        },
      };
    },

    composeSnapshotEntry(versionDoc) {
      const tools = versionDoc && versionDoc.payload && Array.isArray(versionDoc.payload.tools)
        ? versionDoc.payload.tools
        : [];
      return {
        overlayEntries: tools.length,
        disabled: tools.filter((entry) => entry && entry.enabled === false).length,
      };
    },

    resolveRuntime,

    seedPayload() {
      // 空 overlay = 全部静态默认（种子 ≡ P4b 前行为）。
      return { tools: [] };
    },
  });
}

module.exports = Object.freeze({
  createToolPublicationAdapter,
});
