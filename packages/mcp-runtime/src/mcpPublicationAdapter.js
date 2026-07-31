// P4c：MCP 域发布适配器（Config Kernel 域协议，热发布 MCP Server 注册表）。
//
// 发布物是纯声明式注册表，绝不携带鉴权材料：
//   { servers: [{
//       id, transport: "http"|"stdio",
//       url? (http), command?+args?+envAllowlist? (stdio),
//       authEnvVar?,            // 环境变量【名】（引用），值永远不进 Artifact
//       allowedTools: [...],    // 注册白名单：发现≠可用
//       writeTools?: [...],     // ⊆ allowedTools；写操作需确认回执
//       enabled?, runtimeModes?, timeoutMs?
//   }] }
//
// 安全不变量：
// - authEnvVar/envAllowlist 只存变量名（大写标识符模式），任何深度出现
//   key/token/secret/password 字样的其他字段一律拒绝（这两字段经白名单豁免，
//   但值被标识符模式约束，无法夹带密钥）。
// - stdio command 必须 ∈ 服务器注入的受信命令名集（运行时按名解析绝对路径，
//   无任意 shell）；http URL 走传输层同一校验（https 公网 / 显式开发回环）。
// - allowedTools 是注册白名单：MCP 发现的 Tool 不在白名单内一律拒绝调用。
// - 空注册表（{servers: []}）合法，语义 = 无 MCP 服务器（种子 ≡ 无 MCP）。

const SERVER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;
const SECRET_FIELD_PATTERN = /api[-_]?key|token|secret|password|authorization|credential/i;
const RUNTIME_MODES = Object.freeze(["public", "trial", "dev"]);
const TRANSPORTS = Object.freeze(["http", "stdio"]);
const SERVER_FIELDS = Object.freeze([
  "id",
  "transport",
  "url",
  "command",
  "args",
  "envAllowlist",
  "authEnvVar",
  "allowedTools",
  "writeTools",
  "enabled",
  "runtimeModes",
  "timeoutMs",
]);
const LIMITS = Object.freeze({
  servers: 32,
  tools: 128,
  args: 16,
  envAllowlist: 16,
  timeoutMs: Object.freeze({ min: 1000, max: 30000 }),
});

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

// 深度密钥扫描：豁免字段仅两个「引用名」字段（其值被 ENV_NAME_PATTERN
// 约束为大写标识符，无法夹带密钥材料）。
function hasSecretField(value, allowedKeys) {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some((key) => {
    if (allowedKeys && allowedKeys.has(key)) return false;
    if (SECRET_FIELD_PATTERN.test(key)) return true;
    return hasSecretField(value[key], null);
  });
}

function createMcpPublicationAdapter(options = {}) {
  // knownCommands：stdio 受信命令名集（服务器注入；运行时按名解析绝对路径）。
  const knownCommands = new Set((Array.isArray(options.knownCommands) ? options.knownCommands : [])
    .map((name) => safeString(name, 64)).filter(Boolean));
  const allowInsecureHttp = options.allowInsecureHttp === true;

  function validateUrl(rawUrl, errors) {
    const text = safeString(rawUrl, 500);
    if (!text) {
      errors.push("url is required for http transport");
      return "";
    }
    let url;
    try {
      url = new URL(text);
    } catch (_) {
      errors.push("url is not a valid URL");
      return "";
    }
    const host = url.hostname;
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (url.protocol === "https:") {
      if (!host || (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !isLoopback) || host.endsWith(".local") || host.includes(":")) {
        errors.push("https url must use a public hostname (no IP literals/.local)");
        return "";
      }
      return text;
    }
    if (url.protocol === "http:" && allowInsecureHttp && isLoopback) return text;
    errors.push("only https (or loopback http with explicit dev opt-in) is allowed");
    return "";
  }

  function validateStringList(value, field, pattern, maxItems, errors) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > maxItems) {
      errors.push(`${field} must be an array of up to ${maxItems} entries`);
      return undefined;
    }
    const list = [];
    value.forEach((item, index) => {
      const text = safeString(item, 128);
      if (!pattern.test(text)) {
        errors.push(`${field}[${index}] is invalid`);
        return;
      }
      if (!list.includes(text)) list.push(text);
    });
    return list;
  }

  function validate(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errors: ["payload must be a plain object"] };
    }
    Object.keys(payload).forEach((field) => {
      if (field !== "servers") errors.push(`${field} is not a declarative field`);
    });
    if (hasSecretField(payload, new Set(["authEnvVar", "envAllowlist"]))) {
      errors.push("payload must not contain secret material (authEnvVar/envAllowlist hold reference NAMES only)");
    }
    const servers = payload.servers;
    if (servers !== undefined && !Array.isArray(servers)) errors.push("servers must be an array");
    if (Array.isArray(servers) && servers.length > LIMITS.servers) errors.push(`servers exceeds ${LIMITS.servers} entries`);

    const seen = new Set();
    const normalizedServers = [];
    (Array.isArray(servers) ? servers : []).forEach((item, index) => {
      const where = `servers[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${where} must be a plain object`);
        return;
      }
      Object.keys(item).forEach((field) => {
        if (!SERVER_FIELDS.includes(field)) errors.push(`${where}.${field} is not a declarative field`);
      });
      const id = safeString(item.id, 64);
      if (!SERVER_ID_PATTERN.test(id)) {
        errors.push(`${where}.id is invalid`);
        return;
      }
      if (seen.has(id)) {
        errors.push(`${where}.id is duplicated: ${id}`);
        return;
      }
      seen.add(id);
      const transport = safeString(item.transport, 16);
      if (!TRANSPORTS.includes(transport)) {
        errors.push(`${where}.transport must be one of ${TRANSPORTS.join("/")}`);
        return;
      }

      const entry = { id, transport };
      if (transport === "http") {
        if (item.command !== undefined) errors.push(`${where}.command is only valid for stdio transport`);
        const url = validateUrl(item.url, errors);
        if (url) entry.url = url;
      } else {
        if (item.url !== undefined) errors.push(`${where}.url is only valid for http transport`);
        const command = safeString(item.command, 64);
        if (!command || !knownCommands.has(command)) {
          errors.push(`${where}.command is not a trusted command: ${command || "(empty)"}`);
        } else {
          entry.command = command;
        }
        const args = validateStringList(item.args, `${where}.args`, /^[^<>|&;$`]*$/, LIMITS.args, errors);
        if (args) entry.args = args.map((arg) => arg.slice(0, 500));
        const envAllowlist = validateStringList(item.envAllowlist, `${where}.envAllowlist`, ENV_NAME_PATTERN, LIMITS.envAllowlist, errors);
        if (envAllowlist) entry.envAllowlist = envAllowlist;
      }

      if (item.authEnvVar !== undefined) {
        const authEnvVar = safeString(item.authEnvVar, 128);
        if (!ENV_NAME_PATTERN.test(authEnvVar)) {
          errors.push(`${where}.authEnvVar must be an env var NAME (reference, never the value)`);
        } else {
          entry.authEnvVar = authEnvVar;
        }
      }
      const allowedTools = validateStringList(item.allowedTools, `${where}.allowedTools`, TOOL_NAME_PATTERN, LIMITS.tools, errors);
      entry.allowedTools = allowedTools || [];
      const writeTools = validateStringList(item.writeTools, `${where}.writeTools`, TOOL_NAME_PATTERN, LIMITS.tools, errors);
      if (writeTools) {
        writeTools.forEach((tool) => {
          if (!entry.allowedTools.includes(tool)) errors.push(`${where}.writeTools entry is outside allowedTools: ${tool}`);
        });
        entry.writeTools = writeTools;
      }
      if (item.enabled !== undefined) {
        if (typeof item.enabled !== "boolean") errors.push(`${where}.enabled must be a boolean`);
        else entry.enabled = item.enabled;
      }
      const runtimeModes = validateStringList(item.runtimeModes, `${where}.runtimeModes`, /^[a-z]+$/, 3, errors);
      if (runtimeModes) {
        runtimeModes.forEach((mode) => {
          if (!RUNTIME_MODES.includes(mode)) errors.push(`${where}.runtimeModes entry is not supported: ${mode}`);
        });
        entry.runtimeModes = runtimeModes;
      }
      if (item.timeoutMs !== undefined) {
        const num = Number(item.timeoutMs);
        if (!Number.isInteger(num) || num < LIMITS.timeoutMs.min || num > LIMITS.timeoutMs.max) {
          errors.push(`${where}.timeoutMs must be an integer within ${LIMITS.timeoutMs.min}..${LIMITS.timeoutMs.max}`);
        } else {
          entry.timeoutMs = num;
        }
      }
      normalizedServers.push(entry);
    });

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized: { servers: normalizedServers } };
  }

  function resolveRuntime(versionDoc) {
    if (!versionDoc || !versionDoc.payload) throw codedError("MCP_PUBLICATION_VERSION_REQUIRED");
    const validation = validate(versionDoc.payload);
    if (!validation.ok) {
      throw codedError("MCP_PUBLICATION_VERSION_INVALID", validation.errors.join("; ").slice(0, 240));
    }
    return Object.freeze(JSON.parse(JSON.stringify(validation.normalized)));
  }

  return Object.freeze({
    domain: "mcp",

    validate,

    test(normalized) {
      const registry = normalized || { servers: [] };
      const servers = Array.isArray(registry.servers) ? registry.servers : [];
      const enabled = servers.filter((server) => server.enabled !== false);
      const noTools = enabled.find((server) => !(Array.isArray(server.allowedTools) && server.allowedTools.length));
      if (noTools) {
        return { ok: false, results: { reason: `enabled server ${noTools.id} allows no tools` } };
      }
      return {
        ok: true,
        results: {
          servers: servers.length,
          enabled: enabled.length,
          http: servers.filter((server) => server.transport === "http").length,
          stdio: servers.filter((server) => server.transport === "stdio").length,
          writeTools: servers.reduce((count, server) => count + (Array.isArray(server.writeTools) ? server.writeTools.length : 0), 0),
        },
      };
    },

    composeSnapshotEntry(versionDoc) {
      const servers = versionDoc && versionDoc.payload && Array.isArray(versionDoc.payload.servers)
        ? versionDoc.payload.servers
        : [];
      return {
        servers: servers.length,
        enabled: servers.filter((server) => server && server.enabled !== false).length,
      };
    },

    resolveRuntime,

    seedPayload() {
      // 空注册表 = 无 MCP 服务器（种子 ≡ P4c 前行为：平台没有 MCP 调用能力）。
      return { servers: [] };
    },
  });
}

module.exports = Object.freeze({
  createMcpPublicationAdapter,
});
