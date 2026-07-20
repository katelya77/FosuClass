#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-agent-kb-control-"));
process.env.FOSU_ASSISTANT_KB_PATH = path.join(tempDir, "knowledge-docs.json");

const knowledgeBaseService = require("../server/src/services/ai/knowledgeBaseService");
const {
  KnowledgeAuditService,
  KnowledgeRepository,
  KnowledgeSearchProvider,
  KnowledgeValidationService,
  KnowledgeVersionService,
} = require("../server/src/services/ai/knowledgeControlPlane");

try {
  const audit = new KnowledgeAuditService({ maxEntries: 20 });
  const repository = new KnowledgeRepository({ service: knowledgeBaseService, audit });
  const search = new KnowledgeSearchProvider({ service: knowledgeBaseService });
  const validation = new KnowledgeValidationService({ service: knowledgeBaseService });
  const versions = new KnowledgeVersionService({ service: knowledgeBaseService, audit });

  const created = repository.createDraft("doc", {
    title: "Agent V2 test knowledge",
    body: "This is a published lexical knowledge item.",
    keywords: ["agent-v2-test"],
    scope: ["public"],
  });
  assert.ok(created && created.item && created.item.id);
  assert.strictEqual(validation.validateEntry(created.item).ok, true);

  const firstPublish = versions.publish({ versionId: "kb-v1" });
  assert.strictEqual(firstPublish.success, true);
  assert.ok(search.search({ query: "agent-v2-test", environment: "public" }).items.length >= 1);

  repository.updateDraft("doc", created.item.id, { body: "Second version content.", keywords: ["agent-v2-second"] });
  versions.publish({ versionId: "kb-v2" });
  assert.strictEqual(versions.getCurrentVersion().version, "kb-v2");
  versions.rollback("kb-v1");
  assert.strictEqual(versions.getCurrentVersion().version, "kb-v1");
  assert.ok(search.search({ query: "agent-v2-test", environment: "public" }).items.length >= 1);
  assert.strictEqual(audit.list().some((item) => item.action === "rollback"), true);
  assert.ok(!/token|password|api.?key/i.test(JSON.stringify(audit.list())));

  console.log("test-knowledge-control-plane passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
