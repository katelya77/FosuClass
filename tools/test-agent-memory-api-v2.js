#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-memory-api-v2-"));

process.env.NODE_ENV = "development";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_SESSION_SECRET = "test-memory-api-v2-session-secret";
process.env.FOSU_AGENT_MEMORY_SECRET = "test-memory-api-v2-encryption-secret-32";
process.env.FOSU_DYNAMIC_API_SESSION_REQUIRED = "true";
process.env.FOSU_SCHEDULE_RATE_LIMIT_MAX = "500";
process.env.AI_RUNTIME_MODE = "dev";
process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "true";

function serverDependency(name) {
  return require(require.resolve(name, { paths: [path.join(root, "server")] }));
}

const express = serverDependency("express");
const aiRouter = require("../server/src/routes/ai");
const { createSessionToken } = require("../server/src/utils/apiSecurity");
const { defaultMemoryService } = require("../server/src/services/ai/conversation/conversationMemoryService");
const { defaultUserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, Object.assign({}, options, {
    headers: Object.assign({
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 MicroMessenger FosuClass-Memory-V2-Test",
    }, options.headers || {}),
  }));
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }
  return { status: response.status, data };
}

async function testServerApi() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/ai", aiRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const unauthorized = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop");
    assert.strictEqual(unauthorized.status, 401);

    const session = createSessionToken({ appid: "wx-memory-v2", openid: "memory-v2-user" });
    const headers = { "X-Fosu-Session": session.token };
    const principal = defaultMemoryService.resolvePrincipal({
      serverSession: session.payload,
      runtimeMode: "dev",
    });

    const seeded = defaultUserPreferenceService.upsert({
      principal,
      memoryMode: "cloud_sync",
      explicit: true,
      values: { preferredName: "A" },
    });
    assert.strictEqual(seeded.persisted, true);

    const overview = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop", { headers });
    assert.strictEqual(overview.status, 200, JSON.stringify(overview.data));
    assert.strictEqual(overview.data.success, true);
    assert.strictEqual(overview.data.items.length, 1);
    assert.strictEqual(overview.data.items[0].normalizedValue, "A");
    assert.strictEqual(typeof overview.data.policy.autoMemoryEnabled, "boolean");
    const memoryId = overview.data.items[0].memoryId;
    const initialRevision = overview.data.revision;

    const missingItemRevision = await request(baseUrl, `/api/ai/agent/memory/items/${encodeURIComponent(memoryId)}?envVersion=develop`, {
      method: "DELETE",
      headers,
      body: "{}",
    });
    assert.strictEqual(missingItemRevision.status, 400);
    assert.strictEqual(missingItemRevision.data.code, "MEMORY_REVISION_REQUIRED");

    const items = await request(baseUrl, "/api/ai/agent/memory/items?page=1&pageSize=10&envVersion=develop", { headers });
    assert.strictEqual(items.status, 200);
    assert.strictEqual(items.data.total, 1);
    assert.strictEqual(items.data.items[0].memoryId, memoryId);

    const patched = await request(baseUrl, `/api/ai/agent/memory/items/${encodeURIComponent(memoryId)}?envVersion=develop`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        content: "preferredName=B",
        normalizedValue: "B",
        expectedRevision: initialRevision,
      }),
    });
    assert.strictEqual(patched.status, 200, JSON.stringify(patched.data));
    assert.strictEqual(patched.data.memory.normalizedValue, "B");
    assert.strictEqual(patched.data.revision, initialRevision + 1);

    const stalePatch = await request(baseUrl, `/api/ai/agent/memory/items/${encodeURIComponent(memoryId)}?envVersion=develop`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ content: "preferredName=C", expectedRevision: initialRevision }),
    });
    assert.strictEqual(stalePatch.status, 409);
    assert.strictEqual(stalePatch.data.code, "MEMORY_REVISION_CONFLICT");

    const emptyPatch = await request(baseUrl, `/api/ai/agent/memory/items/${encodeURIComponent(memoryId)}?envVersion=develop`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedRevision: patched.data.revision }),
    });
    assert.strictEqual(emptyPatch.status, 400);
    assert.strictEqual(emptyPatch.data.code, "MEMORY_PATCH_INVALID");

    const policy = await request(baseUrl, "/api/ai/agent/memory/policy?envVersion=develop", { headers });
    assert.strictEqual(policy.status, 200);
    assert.strictEqual(policy.data.revision, patched.data.revision);

    const missingPolicyRevision = await request(baseUrl, "/api/ai/agent/memory/policy?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ paused: true }),
    });
    assert.strictEqual(missingPolicyRevision.status, 400);
    assert.strictEqual(missingPolicyRevision.data.code, "MEMORY_REVISION_REQUIRED");

    const paused = await request(baseUrl, "/api/ai/agent/memory/policy?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        autoMemoryEnabled: false,
        paused: true,
        expectedRevision: policy.data.revision,
      }),
    });
    assert.strictEqual(paused.status, 200, JSON.stringify(paused.data));
    assert.strictEqual(paused.data.policy.autoMemoryEnabled, false);
    assert.strictEqual(paused.data.policy.paused, true);

    const legacyPreferences = await request(baseUrl, "/api/ai/agent/memory/preferences?envVersion=develop", { headers });
    assert.strictEqual(legacyPreferences.status, 200);
    assert.strictEqual(legacyPreferences.data.items[0].normalizedValue, "B");
    assert.strictEqual(legacyPreferences.data.autoMemoryEnabled, false);

    const missingLegacyPatchRevision = await request(baseUrl, "/api/ai/agent/memory/preferences?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ key: "preferredName", value: "C" }),
    });
    assert.strictEqual(missingLegacyPatchRevision.status, 400);
    assert.strictEqual(missingLegacyPatchRevision.data.code, "MEMORY_REVISION_REQUIRED");

    const staleLegacyPatch = await request(baseUrl, "/api/ai/agent/memory/preferences?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ key: "preferredName", value: "C", expectedRevision: initialRevision }),
    });
    assert.strictEqual(staleLegacyPatch.status, 409);
    assert.strictEqual(staleLegacyPatch.data.code, "MEMORY_REVISION_CONFLICT");

    const missingLegacyDeleteRevision = await request(baseUrl, "/api/ai/agent/memory/preferences/preferredName?envVersion=develop", {
      method: "DELETE",
      headers,
      body: "{}",
    });
    assert.strictEqual(missingLegacyDeleteRevision.status, 400);
    assert.strictEqual(missingLegacyDeleteRevision.data.code, "MEMORY_REVISION_REQUIRED");

    const editedLegacy = await request(baseUrl, "/api/ai/agent/memory/preferences?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        key: "preferredName",
        value: "C",
        expectedRevision: paused.data.revision,
      }),
    });
    assert.strictEqual(editedLegacy.status, 200, JSON.stringify(editedLegacy.data));
    assert.strictEqual(editedLegacy.data.persisted, true);
    assert.strictEqual(editedLegacy.data.revision, paused.data.revision + 1);
    const editedLegacyList = await request(baseUrl, "/api/ai/agent/memory/preferences?envVersion=develop", { headers });
    assert.strictEqual(editedLegacyList.data.items[0].normalizedValue, "C");
    assert.strictEqual(editedLegacyList.data.items[0].provenance.type, "user_explicit");
    assert.strictEqual(editedLegacyList.data.items[0].confidence, 1);

    const resumedLegacy = await request(baseUrl, "/api/ai/agent/memory/preferences?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        autoMemoryEnabled: true,
        expectedRevision: editedLegacy.data.revision,
      }),
    });
    assert.strictEqual(resumedLegacy.status, 200, JSON.stringify(resumedLegacy.data));
    assert.strictEqual(resumedLegacy.data.persisted, true);
    assert.strictEqual(resumedLegacy.data.autoMemoryEnabled, true);

    const unchangedLegacy = await request(baseUrl, "/api/ai/agent/memory/preferences?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        autoMemoryEnabled: true,
        expectedRevision: resumedLegacy.data.revision,
      }),
    });
    assert.strictEqual(unchangedLegacy.status, 200, JSON.stringify(unchangedLegacy.data));
    assert.strictEqual(unchangedLegacy.data.persisted, false);
    assert.strictEqual(unchangedLegacy.data.revision, resumedLegacy.data.revision);

    const unpaused = await request(baseUrl, "/api/ai/agent/memory/policy?envVersion=develop", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ paused: false, expectedRevision: resumedLegacy.data.revision }),
    });
    assert.strictEqual(unpaused.status, 200, JSON.stringify(unpaused.data));

    const episodeSeed = defaultUserPreferenceService.appendEpisode({
      principal,
      memoryMode: "cloud_sync",
      verified: true,
      expectedRevision: unpaused.data.revision,
      episode: {
        status: "success",
        verified: true,
        goal: "find quiet study room",
        outcomeSummary: "user selected library third floor",
        reusableConstraints: { quiet: true },
        provenanceRunId: "run-memory-api-v2",
      },
    });
    assert.strictEqual(episodeSeed.persisted, true);

    const episodes = await request(baseUrl, "/api/ai/agent/memory/episodes?envVersion=develop", { headers });
    assert.strictEqual(episodes.status, 200);
    assert.strictEqual(episodes.data.items.length, 1);
    const episodeId = episodes.data.items[0].episodeId;

    const deletedEpisode = await request(baseUrl, `/api/ai/agent/memory/episodes/${encodeURIComponent(episodeId)}?envVersion=develop`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ expectedRevision: episodes.data.revision }),
    });
    assert.strictEqual(deletedEpisode.status, 200, JSON.stringify(deletedEpisode.data));
    assert.strictEqual(deletedEpisode.data.deleted, true);

    // Low#2：deleteEpisode 与 deleteMemory 未找到统一 404，且不推进 revision。
    const missingEpisodeDelete = await request(baseUrl, `/api/ai/agent/memory/episodes/${encodeURIComponent("episode_missing_api")}?envVersion=develop`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ expectedRevision: deletedEpisode.data.revision }),
    });
    assert.strictEqual(missingEpisodeDelete.status, 404);
    assert.strictEqual(missingEpisodeDelete.data.code, "EPISODE_NOT_FOUND");
    const missingMemoryDelete = await request(baseUrl, `/api/ai/agent/memory/items/${encodeURIComponent("mem_missing_api")}?envVersion=develop`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ expectedRevision: deletedEpisode.data.revision }),
    });
    assert.strictEqual(missingMemoryDelete.status, 404);
    assert.strictEqual(missingMemoryDelete.data.code, "MEMORY_NOT_FOUND");
    const afterMissingDeletes = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop", { headers });
    assert.strictEqual(afterMissingDeletes.data.revision, deletedEpisode.data.revision, "404 deletes must not advance the revision");

    const exported = await request(baseUrl, "/api/ai/agent/memory/export?envVersion=develop", { headers });
    assert.strictEqual(exported.status, 200);
    assert.strictEqual(exported.data.success, true);
    assert.strictEqual(exported.data.export.schemaVersion, "user-memory.export.v1");
    const exportedActive = exported.data.export.items.find((item) => item.status === "active");
    const exportedSuperseded = exported.data.export.items.find((item) => item.status === "superseded");
    assert.strictEqual(exportedActive.normalizedValue, "C");
    assert.strictEqual(exportedActive.provenance.type, "user_explicit");
    assert.strictEqual(exportedSuperseded.normalizedValue, "B");
    assert.strictEqual(exportedSuperseded.supersededBy, exportedActive.memoryId);

    defaultMemoryService.patchConversation({
      serverSession: session.payload,
      runtimeMode: "dev",
      conversationId: "memory-api-v2-conversation",
      memoryMode: "session_state",
      title: "Memory API v2",
    });
    const missingClearRevision = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop", {
      method: "DELETE",
      headers,
      body: "{}",
    });
    assert.strictEqual(missingClearRevision.status, 400);
    assert.strictEqual(missingClearRevision.data.code, "MEMORY_REVISION_REQUIRED");
    const staleClear = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ expectedRevision: 0 }),
    });
    assert.strictEqual(staleClear.status, 409);
    assert.strictEqual(staleClear.data.code, "MEMORY_REVISION_CONFLICT");
    assert.strictEqual(staleClear.data.partial, false);

    const beforeClear = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop", { headers });
    const cleared = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ expectedRevision: beforeClear.data.revision }),
    });
    assert.strictEqual(cleared.status, 200, JSON.stringify(cleared.data));
    assert.strictEqual(cleared.data.success, true);
    assert.strictEqual(cleared.data.partial, false);
    assert.strictEqual(cleared.data.stores.longTerm.success, true);
    assert.strictEqual(cleared.data.stores.conversations.success, true);

    const empty = await request(baseUrl, "/api/ai/agent/memory?envVersion=develop", { headers });
    assert.strictEqual(empty.data.items.length, 0);
    const noConversations = await request(baseUrl, "/api/ai/agent/conversations?envVersion=develop", { headers });
    assert.strictEqual(noConversations.data.items.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testMiniProgramClientContract() {
  const httpPath = require.resolve("../miniprogram/utils/request");
  const clientPath = require.resolve("../miniprogram/services/agentMemoryClient");
  const originalHttp = require.cache[httpPath];
  const originalClient = require.cache[clientPath];
  const originalWx = global.wx;
  const calls = [];
  let failClear = false;
  const mockHttp = {
    get: async (url, data) => {
      calls.push({ method: "GET", url, data });
      if (url.includes("/conversations")) return { success: true, items: [{ conversationId: "from-items" }] };
      if (url.includes("/memory/items")) return { success: true, revision: 3, total: 1, items: [{ memoryId: "mem-1" }] };
      if (url.includes("/memory/episodes")) return { success: true, revision: 4, items: [{ episodeId: "episode-1" }] };
      if (url.includes("/memory/policy")) return { success: true, revision: 5, policy: { paused: false } };
      if (url.includes("/memory/export")) return { success: true, export: { schemaVersion: "user-memory.export.v1" } };
      if (url.includes("/memory")) return { success: true, revision: 2, policy: {}, items: [], episodes: [] };
      return { success: false, code: "UNEXPECTED_GET" };
    },
    request: async (url, method, data) => {
      calls.push({ method, url, data });
      if (failClear && method === "DELETE" && /\/agent\/memory\?/.test(url)) {
        return {
          success: false,
          code: "MEMORY_CLEAR_PARTIAL",
          partial: true,
          revision: 10,
          stores: { longTerm: { success: true }, conversations: { success: false } },
        };
      }
      return { success: true, revision: 9, memory: { memoryId: "mem-1" }, deleted: true, policy: { paused: true }, stores: {} };
    },
    post: async (url, data) => {
      calls.push({ method: "POST", url, data });
      return { success: true };
    },
  };

  global.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: "trial" } }) };
  require.cache[httpPath] = { id: httpPath, filename: httpPath, loaded: true, exports: mockHttp };
  delete require.cache[clientPath];
  try {
    const client = require(clientPath);
    const conversations = await client.listCloudConversations();
    assert.strictEqual(conversations.conversations[0].conversationId, "from-items");

    const snapshot = await client.getMemorySnapshot();
    assert.strictEqual(snapshot.revision, 2);
    const items = await client.listMemoryItems({ page: 1, pageSize: 25 });
    assert.strictEqual(items.items[0].memoryId, "mem-1");
    const patched = await client.patchMemoryItem("mem-1", { content: "updated" }, 3);
    assert.strictEqual(patched.success, true);
    await client.deleteMemoryItem("mem-1", 9);
    const episodes = await client.listMemoryEpisodes();
    assert.strictEqual(episodes.items[0].episodeId, "episode-1");
    await client.deleteMemoryEpisode("episode-1", 4);
    const policy = await client.getMemoryPolicy();
    assert.strictEqual(policy.revision, 5);
    await client.patchMemoryPolicy({ paused: true }, 5);
    const exported = await client.exportCloudMemory();
    assert.strictEqual(exported.export.schemaVersion, "user-memory.export.v1");
    await client.clearCloudMemory(9);
    failClear = true;
    const partialClear = await client.clearCloudMemory(10);
    assert.strictEqual(partialClear.success, false);
    assert.strictEqual(partialClear.partial, true);
    assert.strictEqual(partialClear.stores.longTerm.success, true);

    const patchCall = calls.find((call) => call.method === "PATCH" && call.url.includes("/memory/items/mem-1"));
    assert.deepStrictEqual(patchCall.data, { content: "updated", expectedRevision: 3 });
    const deleteCall = calls.find((call) => call.method === "DELETE" && call.url.includes("/memory/items/mem-1"));
    assert.deepStrictEqual(deleteCall.data, { expectedRevision: 9 });
    const policyCall = calls.find((call) => call.method === "PATCH" && call.url.includes("/memory/policy"));
    assert.deepStrictEqual(policyCall.data, { paused: true, expectedRevision: 5 });
    const clearCall = calls.find((call) => call.method === "DELETE" && /\/agent\/memory\?/.test(call.url));
    assert.deepStrictEqual(clearCall.data, { expectedRevision: 9 });
    calls.forEach((call) => assert.ok(call.url.includes("envVersion=trial"), call.url));
  } finally {
    if (originalHttp) require.cache[httpPath] = originalHttp;
    else delete require.cache[httpPath];
    if (originalClient) require.cache[clientPath] = originalClient;
    else delete require.cache[clientPath];
    global.wx = originalWx;
  }
}

async function run() {
  try {
    await testServerApi();
    await testMiniProgramClientContract();
    console.log("test-agent-memory-api-v2: PASS");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
