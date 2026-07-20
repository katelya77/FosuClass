#!/usr/bin/env node
const assert = require("assert");
const path = require("path");

const mcp = require("./fosu-kb-mcp/server");

assert.ok(mcp.ALLOWED_TOOLS.has("kb_search"));
assert.ok(mcp.ALLOWED_TOOLS.has("kb_create_draft"));
assert.ok(mcp.ALLOWED_TOOLS.has("kb_diff"));
assert.ok(!mcp.ALLOWED_TOOLS.has("kb_publish"));
assert.ok(!mcp.ALLOWED_TOOLS.has("kb_rollback"));
assert.ok(mcp.FORBIDDEN_TOOLS.has("kb_publish"));
assert.ok(mcp.FORBIDDEN_TOOLS.has("kb_rollback"));

const tools = mcp.toolDefinitions().map((item) => item.name);
assert.ok(!tools.includes("kb_publish"));
assert.ok(!tools.includes("kb_rollback"));
assert.ok(!tools.includes("kb_delete_published"));

const resources = mcp.resourceTemplates().map((item) => item.uri);
assert.ok(resources.includes("fosu-kb://schema"));
assert.ok(resources.includes("fosu-kb://published"));
assert.ok(resources.includes("fosu-kb://drafts"));
assert.ok(resources.includes("fosu-kb://audit/recent"));

// Server source must not read knowledge JSON files directly.
const serverSource = require("fs").readFileSync(path.join(__dirname, "fosu-kb-mcp/server.js"), "utf8");
assert.ok(!/knowledge-docs\.json|FOSU_ASSISTANT_KB_PATH|readFileSync\(.*knowledge/.test(serverSource));
assert.ok(serverSource.includes("/api/admin/assistant-kb"));
assert.ok(serverSource.includes("Idempotency-Key") || serverSource.includes("idempotencyKey"));
assert.ok(serverSource.includes("redactForLog"));
assert.ok(!/FOSU_KB_MCP_TOKEN\s*=\s*['\"][^'\"]+['\"]/.test(serverSource));

console.log("test-kb-mcp passed");
