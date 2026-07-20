#!/usr/bin/env node
/**
 * FosuClass Knowledge Base MCP Server (stdio)
 *
 * Trust boundary:
 *   MCP Client → this process → protected Admin HTTP API → Knowledge Control Plane
 *
 * Never reads knowledge JSON files directly.
 * Never registers publish / rollback tools.
 *
 * Auth: FOSU_KB_MCP_TOKEN or ADMIN_SERVICE_TOKEN env only (never commit tokens).
 */
"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");
const readline = require("readline");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "fosu-kb-mcp", version: "1.0.0" };

const ALLOWED_TOOLS = new Set([
  "kb_search",
  "kb_get",
  "kb_create_draft",
  "kb_update_draft",
  "kb_preview_import",
  "kb_validate",
  "kb_diff",
  "kb_delete_draft",
]);

const FORBIDDEN_TOOLS = new Set([
  "kb_publish",
  "kb_rollback",
  "kb_delete_published",
  "kb_change_provider",
  "kb_execute_admin_command",
]);

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getConfig() {
  const baseUrl = env("FOSU_KB_MCP_BASE_URL", env("FOSU_ADMIN_BASE_URL", "http://127.0.0.1:3000"));
  const token = env("FOSU_KB_MCP_TOKEN", env("ADMIN_SERVICE_TOKEN", env("ADMIN_API_TOKEN", "")));
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    token,
    clientName: env("FOSU_KB_MCP_CLIENT_NAME", "fosu-kb-mcp"),
  };
}

function redactForLog(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"',}]+/gi, "$1=[redacted]");
}

function httpJson(method, pathName, body, headers = {}) {
  const config = getConfig();
  if (!config.token) {
    const error = new Error("Missing FOSU_KB_MCP_TOKEN (scoped service token required)");
    error.code = "MCP_TOKEN_MISSING";
    throw error;
  }
  const url = new URL(pathName.startsWith("http") ? pathName : `${config.baseUrl}${pathName}`);
  const payload = body == null ? null : JSON.stringify(body);
  const transport = url.protocol === "https:" ? https : http;
  const options = {
    method,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    headers: Object.assign({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
      "X-Admin-Token": config.token,
      "X-Fosu-Client": config.clientName,
    }, headers),
    timeout: 20000,
  };
  if (payload) options.headers["Content-Length"] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (error) {
          return reject(Object.assign(new Error("Invalid JSON from admin API"), { code: "MCP_UPSTREAM_INVALID_JSON", statusCode: res.statusCode }));
        }
        if (res.statusCode >= 400) {
          const err = new Error((data && data.message) || `Upstream ${res.statusCode}`);
          err.code = (data && data.code) || "MCP_UPSTREAM_ERROR";
          err.statusCode = res.statusCode;
          err.data = data;
          return reject(err);
        }
        resolve(data);
      });
    });
    req.on("error", (error) => {
      error.code = error.code || "MCP_UPSTREAM_NETWORK";
      reject(error);
    });
    req.on("timeout", () => {
      req.destroy();
      const error = new Error("Upstream timeout");
      error.code = "MCP_UPSTREAM_TIMEOUT";
      reject(error);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function toolDefinitions() {
  return [
    {
      name: "kb_search",
      description: "Search published assistant knowledge (lexical). Scope: assistant-kb:read",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          environment: { type: "string", enum: ["public", "trial", "dev"] },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "kb_get",
      description: "Get one knowledge entry by id. status=published|draft",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["published", "draft"] },
        },
        required: ["id"],
      },
    },
    {
      name: "kb_create_draft",
      description: "Create a draft knowledge entry. Never publishes.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["doc", "rule"] },
          title: { type: "string" },
          body: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          scope: { type: "array", items: { type: "string" } },
          sourceUrl: { type: "string" },
          sourceTitle: { type: "string" },
          sourcePublisher: { type: "string" },
          authorityLevel: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        required: ["title", "body"],
      },
    },
    {
      name: "kb_update_draft",
      description: "Update draft with optional expectedRevision / If-Match concurrency.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          patch: { type: "object" },
          expectedRevision: { type: "number" },
          idempotencyKey: { type: "string" },
        },
        required: ["id", "patch"],
      },
    },
    {
      name: "kb_preview_import",
      description: "Preview markdown import without writing.",
      inputSchema: {
        type: "object",
        properties: {
          markdown: { type: "string" },
          title: { type: "string" },
          sourceUrl: { type: "string" },
        },
        required: ["markdown"],
      },
    },
    {
      name: "kb_validate",
      description: "Validate entry or import for secrets / prompt injection.",
      inputSchema: {
        type: "object",
        properties: {
          entry: { type: "object" },
          markdown: { type: "string" },
        },
      },
    },
    {
      name: "kb_diff",
      description: "Field-level diff between draft and published knowledge.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "kb_delete_draft",
      description: "Delete a draft entry only.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ];
}

function resourceTemplates() {
  return [
    { uri: "fosu-kb://schema", name: "Knowledge schema", mimeType: "application/json" },
    { uri: "fosu-kb://version", name: "Published version", mimeType: "application/json" },
    { uri: "fosu-kb://published", name: "Published entries", mimeType: "application/json" },
    { uri: "fosu-kb://drafts", name: "Draft entries", mimeType: "application/json" },
    { uri: "fosu-kb://audit/recent", name: "Recent KB audit", mimeType: "application/json" },
  ];
}

async function readResource(uri) {
  if (uri === "fosu-kb://schema") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          schemaVersion: "assistant-kb.v2",
          entryFields: [
            "id", "type", "title", "body", "scope", "keywords", "revision", "contentHash",
            "sourceUrl", "sourceTitle", "sourcePublisher", "authorityLevel", "retrievedAt",
          ],
          authorityLevels: [
            "official", "school_department", "project_documentation",
            "trusted_secondary", "community", "unknown",
          ],
          notes: "Missing source cannot auto-promote to official. Publish/rollback not available via MCP.",
        }, null, 2),
      }],
    };
  }
  if (uri === "fosu-kb://version") {
    const list = await httpJson("GET", "/api/admin/assistant-kb?status=published");
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          version: list.controlPlane && list.controlPlane.version || list.store,
          published: list.published,
        }, null, 2),
      }],
    };
  }
  if (uri === "fosu-kb://published") {
    const list = await httpJson("GET", "/api/admin/assistant-kb?status=published");
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ entries: (list.entries || []).map(publicEntry) }, null, 2),
      }],
    };
  }
  if (uri.startsWith("fosu-kb://published/")) {
    const id = decodeURIComponent(uri.slice("fosu-kb://published/".length));
    const list = await httpJson("GET", "/api/admin/assistant-kb?status=published");
    const entry = (list.entries || []).find((item) => item.id === id || item.sourceId === id);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(entry ? publicEntry(entry) : { error: "NOT_FOUND", id }, null, 2),
      }],
    };
  }
  if (uri === "fosu-kb://drafts") {
    const list = await httpJson("GET", "/api/admin/assistant-kb?status=draft");
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ entries: (list.entries || []).map(publicEntry) }, null, 2),
      }],
    };
  }
  if (uri.startsWith("fosu-kb://drafts/")) {
    const id = decodeURIComponent(uri.slice("fosu-kb://drafts/".length));
    const list = await httpJson("GET", "/api/admin/assistant-kb?status=draft");
    const entry = (list.entries || []).find((item) => item.id === id || item.sourceId === id);
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(entry ? publicEntry(entry) : { error: "NOT_FOUND", id }, null, 2),
      }],
    };
  }
  if (uri === "fosu-kb://audit/recent") {
    const audit = await httpJson("GET", "/api/admin/assistant-kb/audit?limit=30");
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(audit, null, 2),
      }],
    };
  }
  const error = new Error(`Unknown resource: ${uri}`);
  error.code = "RESOURCE_NOT_FOUND";
  throw error;
}

function publicEntry(entry = {}) {
  return {
    id: entry.id,
    sourceId: entry.sourceId,
    type: entry.type,
    title: entry.title,
    status: entry.status,
    scope: entry.scope,
    keywords: entry.keywords,
    revision: entry.revision,
    contentHash: entry.contentHash,
    authorityLevel: entry.authorityLevel,
    sourceUrl: entry.sourceUrl,
    sourceTitle: entry.sourceTitle,
    sourcePublisher: entry.sourcePublisher,
    updatedAt: entry.updatedAt,
    bodyPreview: String(entry.body || entry.reply || "").slice(0, 240),
  };
}

async function callTool(name, args = {}) {
  if (FORBIDDEN_TOOLS.has(name)) {
    const error = new Error(`Tool ${name} is forbidden on MCP surface`);
    error.code = "MCP_TOOL_FORBIDDEN";
    throw error;
  }
  if (!ALLOWED_TOOLS.has(name)) {
    const error = new Error(`Unknown tool: ${name}`);
    error.code = "MCP_TOOL_UNKNOWN";
    throw error;
  }

  if (name === "kb_search") {
    const payload = await httpJson("POST", "/api/admin/assistant-kb/test", {
      query: args.query,
      environment: args.environment || "public",
      limit: args.limit || 8,
    });
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "kb_get") {
    const status = args.status === "draft" ? "draft" : "published";
    const list = await httpJson("GET", `/api/admin/assistant-kb?status=${status}`);
    const entry = (list.entries || []).find((item) => item.id === args.id || item.sourceId === args.id);
    return { content: [{ type: "text", text: JSON.stringify(entry ? publicEntry(entry) : { error: "NOT_FOUND" }, null, 2) }] };
  }

  if (name === "kb_create_draft") {
    const headers = {};
    if (args.idempotencyKey) headers["Idempotency-Key"] = String(args.idempotencyKey);
    const payload = await httpJson("POST", "/api/admin/assistant-kb", {
      type: args.type || "doc",
      title: args.title,
      body: args.body,
      keywords: args.keywords,
      scope: args.scope,
      sourceUrl: args.sourceUrl,
      sourceTitle: args.sourceTitle,
      sourcePublisher: args.sourcePublisher,
      authorityLevel: args.authorityLevel,
    }, headers);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "kb_update_draft") {
    const headers = {};
    if (args.idempotencyKey) headers["Idempotency-Key"] = String(args.idempotencyKey);
    if (args.expectedRevision != null) headers["If-Match"] = String(args.expectedRevision);
    const body = Object.assign({}, args.patch || {}, {
      expectedRevision: args.expectedRevision,
    });
    const payload = await httpJson("PUT", `/api/admin/assistant-kb/${encodeURIComponent(args.id)}`, body, headers);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "kb_preview_import") {
    const payload = await httpJson("POST", "/api/admin/assistant-kb/import-md", {
      markdown: args.markdown,
      title: args.title,
      sourceUrl: args.sourceUrl,
      commit: false,
    });
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "kb_validate") {
    const payload = await httpJson("POST", "/api/admin/assistant-kb/validate", {
      entry: args.entry,
      markdown: args.markdown,
      content: args.markdown,
    });
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "kb_diff") {
    const payload = await httpJson("GET", "/api/admin/assistant-kb/diff");
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "kb_delete_draft") {
    const payload = await httpJson("DELETE", `/api/admin/assistant-kb/${encodeURIComponent(args.id)}`);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  const error = new Error(`Unhandled tool ${name}`);
  error.code = "MCP_TOOL_UNHANDLED";
  throw error;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  if (message.jsonrpc !== "2.0") return;

  // notifications have no id
  const isNotification = id === undefined || id === null;

  try {
    if (method === "initialize") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
          },
          serverInfo: SERVER_INFO,
        },
      });
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return;
    }
    if (method === "ping") {
      return send({ jsonrpc: "2.0", id, result: {} });
    }
    if (method === "tools/list") {
      return send({ jsonrpc: "2.0", id, result: { tools: toolDefinitions() } });
    }
    if (method === "tools/call") {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (FORBIDDEN_TOOLS.has(name)) {
        return send({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ error: "MCP_TOOL_FORBIDDEN", tool: name }) }],
          },
        });
      }
      const result = await callTool(name, args);
      return send({ jsonrpc: "2.0", id, result });
    }
    if (method === "resources/list") {
      return send({ jsonrpc: "2.0", id, result: { resources: resourceTemplates() } });
    }
    if (method === "resources/read") {
      const result = await readResource(params && params.uri);
      return send({ jsonrpc: "2.0", id, result });
    }
    if (method === "prompts/list") {
      return send({ jsonrpc: "2.0", id, result: { prompts: [] } });
    }

    if (!isNotification) {
      return send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  } catch (error) {
    if (isNotification) {
      process.stderr.write(`${redactForLog(error.message || String(error))}\n`);
      return;
    }
    return send({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: redactForLog(error.message || "MCP error"),
        data: { code: error.code || "MCP_ERROR", statusCode: error.statusCode || 0 },
      },
    });
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const text = String(line || "").trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }
    Promise.resolve(handleMessage(message)).catch((error) => {
      process.stderr.write(`${redactForLog(error && error.message || String(error))}\n`);
    });
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWED_TOOLS,
  FORBIDDEN_TOOLS,
  callTool,
  getConfig,
  handleMessage,
  publicEntry,
  resourceTemplates,
  toolDefinitions,
};
