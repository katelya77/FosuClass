// P4c：MCP 传输层。
//
// Streamable HTTP（优先）：
//   - POST JSON-RPC；响应可为 application/json 或 text/event-stream（SSE）；
//   - Mcp-Session-Id 请求/响应头透传（有状态服务器）；
//   - URL 校验：默认仅 https；localhost/127.0.0.1 仅当显式 allowInsecureHttp
//     （开发态）才允许 http；禁止 IP 字面量（localhost 除外）与 .local 域。
//
// 受控 stdio（白名单）：
//   - command 必须 ∈ 注入的受信命令集（按解析后的真实路径比对，防 PATH 劫持）；
//   - 永远 shell:false + 参数数组（无任意 shell 解释）；
//   - 子进程环境仅显式白名单变量（不继承宿主密钥）；
//   - 行分隔 JSON-RPC（MCP stdio 帧格式）；超时/取消即 kill。
//
// 鉴权材料绝不进 descriptor/日志：HTTP bearer 由调用方按 authEnvVar 引用名
// 在调用时注入；本层只透传，不持久化。

const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");
const { buildRequest, codedError, parseSseMessages, unwrapResponse } = require("./jsonRpc");

const DEFAULT_TIMEOUT_MS = 15000;

function validateServerUrl(rawUrl, { allowInsecureHttp = false } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch (_) {
    throw codedError("MCP_URL_INVALID", "server url is not a valid URL");
  }
  const host = url.hostname;
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (url.protocol === "https:") {
    if (!host || (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !isLoopback)) {
      throw codedError("MCP_URL_INVALID", "https url must use a public hostname (no IP literals)");
    }
    if (host.endsWith(".local") || host.includes(":")) {
      throw codedError("MCP_URL_INVALID", "https url host is not allowed");
    }
    return url;
  }
  if (url.protocol === "http:" && allowInsecureHttp && isLoopback) {
    return url;
  }
  throw codedError("MCP_URL_INVALID", "only https (or loopback http with explicit dev opt-in) is allowed");
}

function combineSignals(signal, timeoutMs, onTimeout) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    if (typeof onTimeout === "function") onTimeout();
  }, timeoutMs);
  let abortListener = null;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort();
      return { signal: controller.signal, done: () => {}, timedOut: () => true, userAborted: () => true };
    }
    abortListener = () => controller.abort();
    signal.addEventListener("abort", abortListener, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    },
    timedOut: () => timedOut,
    userAborted: () => Boolean(signal && signal.aborted) && !timedOut,
  };
}

function postJsonRpc(url, message, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const payload = JSON.stringify(message);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "Content-Length": Buffer.byteLength(payload),
  };
  if (options.sessionId) headers["Mcp-Session-Id"] = String(options.sessionId).slice(0, 128);
  if (options.bearerToken) headers.Authorization = `Bearer ${options.bearerToken}`;
  if (options.protocolVersion) headers["MCP-Protocol-Version"] = String(options.protocolVersion).slice(0, 40);

  const link = combineSignals(options.signal, timeoutMs);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request({
      method: "POST",
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
      signal: link.signal,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        link.done();
        const raw = Buffer.concat(chunks).toString("utf8");
        const sessionId = res.headers["mcp-session-id"] ? String(res.headers["mcp-session-id"]).slice(0, 128) : undefined;
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(codedError("MCP_AUTH_FAILED", `upstream ${res.statusCode}`));
        }
        if (res.statusCode === 429) {
          return reject(codedError("MCP_RATE_LIMITED", "upstream 429"));
        }
        if (res.statusCode && res.statusCode >= 400) {
          return reject(codedError("MCP_UPSTREAM_HTTP", `upstream ${res.statusCode}`));
        }
        const contentType = String(res.headers["content-type"] || "");
        try {
          if (contentType.includes("text/event-stream")) {
            const messages = parseSseMessages(raw);
            const response = messages.find((item) => item && item.id === message.id);
            if (!response) throw codedError("MCP_RPC_INVALID_RESPONSE", "no matching response in SSE stream");
            return resolve({ result: unwrapResponse(response, message.id), sessionId });
          }
          const parsed = raw ? JSON.parse(raw) : null;
          return resolve({ result: unwrapResponse(parsed, message.id), sessionId });
        } catch (error) {
          if (error && error.code) return reject(error);
          return reject(codedError("MCP_UPSTREAM_INVALID_JSON", "unparseable upstream body"));
        }
      });
      res.on("error", (error) => {
        link.done();
        reject(codedError("MCP_UPSTREAM_NETWORK", String(error && error.message || "stream error").slice(0, 200)));
      });
    });
    req.on("error", (error) => {
      link.done();
      if (link.timedOut()) return reject(codedError("MCP_TIMEOUT", `no response within ${timeoutMs}ms`));
      if (link.userAborted() || (error && error.name === "AbortError")) {
        return reject(codedError("MCP_ABORTED", "call aborted by caller"));
      }
      reject(codedError("MCP_UPSTREAM_NETWORK", String(error && error.message || "network error").slice(0, 200)));
    });
    req.write(payload);
    req.end();
  });
}

// 受控 stdio 会话：每次调用独立进程（无常驻状态，崩溃即整调用失败，
// 不存在半开连接复用问题；MCP stdio 服务器多为短命批处理语义）。
function stdioJsonRpc(server, message, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const link = combineSignals(options.signal, timeoutMs);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(server.resolvedCommand, server.args || [], {
        shell: false,
        env: server.childEnv || {},
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      link.done();
      return reject(codedError("MCP_STDIO_SPAWN_FAILED", String(error && error.message || "spawn failed").slice(0, 200)));
    }
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      link.done();
      try {
        child.kill("SIGTERM");
      } catch (_) {
        // 已退出。
      }
      if (error) return reject(error);
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish(codedError("MCP_TIMEOUT", `stdio call exceeded ${timeoutMs}ms`));
    }, timeoutMs + 50);
    if (link.signal.aborted) {
      clearTimeout(timer);
      return finish(codedError("MCP_ABORTED", "call aborted by caller"));
    }
    link.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      finish(codedError(link.timedOut() ? "MCP_TIMEOUT" : "MCP_ABORTED", link.timedOut() ? `stdio call exceeded ${timeoutMs}ms` : "call aborted by caller"));
    }, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish(codedError("MCP_STDIO_SPAWN_FAILED", String(error && error.message || "spawn failed").slice(0, 200)));
    });
    child.stdout.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch (_) {
          continue; // 服务器日志行安全忽略
        }
        if (parsed && parsed.id === message.id) {
          clearTimeout(timer);
          try {
            return finish(null, { result: unwrapResponse(parsed, message.id) });
          } catch (error) {
            return finish(error);
          }
        }
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(codedError("MCP_STDIO_CLOSED", `server exited (code ${code}) before answering`));
    });
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      child.stdin.end();
    } catch (error) {
      clearTimeout(timer);
      finish(codedError("MCP_STDIO_WRITE_FAILED", String(error && error.message || "write failed").slice(0, 200)));
    }
  });
}

module.exports = Object.freeze({
  DEFAULT_TIMEOUT_MS,
  postJsonRpc,
  stdioJsonRpc,
  validateServerUrl,
});
