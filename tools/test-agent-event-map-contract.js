#!/usr/bin/env node
// M5-T5 contract test: AG-UI event map + agent labels single-source chain.
// Locks: generator --check guard, dual-copy byte identity, EVENT_MAP integrity,
// aguiAdapter/gateway/客户端消费点全部引用生成物（手工映射表已消失）。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const results = [];
function group(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    results.push({ name, ok: false, error });
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
  }
}

const GEN_SERVER = "server/src/shared/aguiEventMap.generated.js";
const GEN_GATEWAY = "cloudfunctions/common/aguiEventMap.generated.js";
const LABELS_SERVER = "server/src/shared/agentLabels.generated.js";
const LABELS_MINI = "miniprogram/shared/agentLabels.generated.js";

group("g1 generator --check guard is current", () => {
  const res = spawnSync(process.execPath, [path.join(root, "tools/generate-agent-event-map.js"), "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.strictEqual(res.status, 0, `generator --check must exit 0, got ${res.status}: ${res.stderr || res.stdout}`);
});

group("g2 dual generated copies are byte-identical", () => {
  assert.strictEqual(read(GEN_SERVER), read(GEN_GATEWAY), "server vs gateway aguiEventMap copies diverged");
  assert.strictEqual(read(LABELS_SERVER), read(LABELS_MINI), "server vs miniprogram agentLabels copies diverged");
});

group("g3 EVENT_MAP integrity against catalog", () => {
  const gen = require(path.join(root, GEN_SERVER));
  const catalog = require(path.join(root, "server/src/services/ai/runEventCatalog.js"));
  const catalogTypes = catalog.EVENT_TYPES || (catalog.runEventCatalog && catalog.runEventCatalog.EVENT_TYPES);
  assert.ok(Array.isArray(gen.EVENT_TYPES) && gen.EVENT_TYPES.length >= 30, "EVENT_TYPES present");
  const typeSet = new Set(gen.EVENT_TYPES);
  for (const t of Object.keys(gen.EVENT_MAP)) {
    assert.ok(typeSet.has(t), `EVENT_MAP key ${t} not in EVENT_TYPES`);
  }
  for (const t of gen.EVENT_TYPES) {
    const mapped = gen.mapRunEventType(t);
    assert.ok(typeof mapped === "string" && /^[A-Z_]+$/.test(mapped), `${t} must map to an AG-UI style token, got ${mapped}`);
  }
  assert.strictEqual(gen.mapRunEventType("no.such.event"), null, "unknown event must map to null");
  if (catalogTypes) {
    assert.deepStrictEqual([...gen.EVENT_TYPES].sort(), [...catalogTypes].sort(), "generated EVENT_TYPES must mirror catalog");
  }
});

group("g4 aguiAdapter consumes generated map (no hand table)", () => {
  const src = read("server/src/services/ai/aguiAdapter.js");
  assert.ok(src.includes('require("../../shared/aguiEventMap.generated")'), "aguiAdapter must require generated map");
  assert.ok(!/const\s+EVENT_MAP\s*=\s*\{/.test(src), "aguiAdapter must not keep a hand-written EVENT_MAP table");
});

group("g5 gateway keeps no second EVENT_MAP", () => {
  const src = read("cloudfunctions/xiaofuAgentGateway/index.js");
  assert.ok(!/EVENT_MAP/.test(src), "gateway must not contain any EVENT_MAP (dead duplicate removed)");
  // gateway hardening (M5-T2): no default trial injection
  assert.ok(!/body\.envVersion\s*\|\|\s*"trial"/.test(src), "gateway must not default-inject trial envVersion");
});

group("g6 labels fully sourced from manifest, no placeholder", () => {
  const labels = require(path.join(root, LABELS_SERVER));
  const manifest = JSON.parse(read("server/config/agent-capability-manifest.json"));
  const toolIds = Object.keys(manifest.tools || {});
  assert.deepStrictEqual(Object.keys(labels.TOOL_LABELS).sort(), toolIds.sort(), "TOOL_LABELS keys must equal manifest.tools keys");
  for (const [id, label] of Object.entries(labels.TOOL_LABELS)) {
    assert.ok(label && label !== id, `tool ${id} label must be a real Chinese name, got ${label}`);
    assert.ok(/[\u4e00-\u9fff]/.test(label), `tool ${id} label must contain Chinese, got ${label}`);
  }
  const cardTypes = manifest.cardTypes || [];
  assert.deepStrictEqual(Object.keys(labels.CARD_TYPE_LABELS).sort(), [...cardTypes].sort(), "CARD_TYPE_LABELS keys must equal manifest.cardTypes");
  for (const [ct, label] of Object.entries(labels.CARD_TYPE_LABELS)) {
    assert.ok(label && label !== ct && /[\u4e00-\u9fff]/.test(label), `card type ${ct} label must be real Chinese, got ${label}`);
  }
});

group("g7 miniprogram consumers use generated labels (dual tables gone)", () => {
  const page = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
  const comp = read("miniprogram/packageXiaofu/components/xiaofu-agent-run/index.js");
  assert.ok(page.includes("agentLabels.generated"), "page must require generated labels");
  assert.ok(comp.includes("agentLabels.generated"), "xiaofu-agent-run must require generated labels");
  assert.ok(!/PUBLIC_TOOL_LABELS\s*=\s*\{/.test(page) && !/PUBLIC_TOOL_LABELS\s*=\s*\{/.test(comp), "manual PUBLIC_TOOL_LABELS table must be gone");
  assert.ok(!page.includes("fosu_rag_retriever") && !comp.includes("fosu_rag_retriever"), "dead label keys must be gone");
});

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  process.stderr.write(`test-agent-event-map-contract: ${failed.length} group(s) failed\n`);
  process.exit(1);
}
process.stdout.write("test-agent-event-map-contract: PASS\n");
