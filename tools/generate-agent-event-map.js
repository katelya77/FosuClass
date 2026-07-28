#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "server", "src", "services", "ai", "runEventCatalog.js");
const adapterPath = path.join(root, "server", "src", "services", "ai", "aguiAdapter.js");
const manifestPath = path.join(root, "server", "config", "agent-capability-manifest.json");

// AG-UI event map single source: runEventCatalog EVENT_TYPES (frozen catalog) +
// aguiAdapter EVENT_MAP (current mapping baseline, M2 included). M5-T2 switches
// both consumers (server aguiAdapter + cloudfunctions/xiaofuAgentGateway) to the
// generated copies below; gateway shares cloud modules via require("../common/...").
const aguiEventMapOutputs = [
  path.join(root, "server", "src", "shared", "aguiEventMap.generated.js"),
  path.join(root, "cloudfunctions", "common", "aguiEventMap.generated.js"),
];
// Tool/card Chinese labels single source: agent-capability-manifest.json.
// Consumed by M5-T4 (miniprogram ai-assistant page + xiaofu-agent-run component).
const agentLabelsOutputs = [
  path.join(root, "server", "src", "shared", "agentLabels.generated.js"),
  path.join(root, "miniprogram", "shared", "agentLabels.generated.js"),
];

const { EVENT_TYPES } = require(catalogPath);
const { EVENT_MAP } = require(adapterPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function assertEventMapCoverage() {
  const missing = EVENT_TYPES.filter((type) => !Object.prototype.hasOwnProperty.call(EVENT_MAP, type));
  const extra = Object.keys(EVENT_MAP).filter((type) => EVENT_TYPES.indexOf(type) === -1);
  if (missing.length || extra.length) {
    console.error(
      "runEventCatalog EVENT_TYPES and aguiAdapter EVENT_MAP are out of sync." +
      (missing.length ? ` Missing mappings: ${missing.join(", ")}.` : "") +
      (extra.length ? ` Unknown event types: ${extra.join(", ")}.` : "") +
      " Update aguiAdapter.js EVENT_MAP first (catalog semantics are owned by M2-style reviews)."
    );
    process.exit(1);
  }
}

function renderAguiEventMap() {
  return [
    "// Generated from server/src/services/ai/runEventCatalog.js (EVENT_TYPES) + server/src/services/ai/aguiAdapter.js (EVENT_MAP). Do not edit by hand.",
    "// Regenerate: node tools/generate-agent-event-map.js",
    `const EVENT_TYPES = Object.freeze(${JSON.stringify(EVENT_TYPES, null, 2)});`,
    "",
    `const EVENT_MAP = Object.freeze(${JSON.stringify(EVENT_MAP, null, 2)});`,
    "",
    "function mapRunEventType(type) {",
    "  return EVENT_MAP[String(type || \"\")] || null;",
    "}",
    "",
    "module.exports = {",
    "  EVENT_TYPES,",
    "  EVENT_MAP,",
    "  mapRunEventType,",
    "};",
    "",
  ].join("\n");
}

function buildAgentLabels() {
  const tools = manifest.tools && typeof manifest.tools === "object" ? manifest.tools : {};
  const intents = manifest.intents && typeof manifest.intents === "object" ? manifest.intents : {};
  const cardTypes = Array.isArray(manifest.cardTypes) ? manifest.cardTypes : [];
  const manifestCardTypeLabels = manifest.cardTypeLabels && typeof manifest.cardTypeLabels === "object"
    ? manifest.cardTypeLabels
    : {};
  const toolIds = Object.keys(tools);
  if (!toolIds.length || !cardTypes.length) {
    console.error("agent-capability-manifest.json is missing tools or cardTypes; refuse to generate empty labels.");
    process.exit(1);
  }
  const readName = (value) => (typeof value === "string" ? value.trim() : "");
  const toolLabels = {};
  toolIds.forEach((toolId) => {
    // Tool-level displayName (M5-T4) wins; same-id intent displayName is the
    // fallback; the raw id stays as the last-resort honest placeholder.
    const toolName = readName(tools[toolId] && tools[toolId].displayName);
    const intent = intents[toolId];
    const intentName = intent ? readName(intent.displayName) : "";
    toolLabels[toolId] = toolName || intentName || toolId;
  });
  const cardTypeLabels = {};
  cardTypes.forEach((cardType) => {
    // manifest.cardTypeLabels (M5-T4) is the card-label authority; the raw key
    // stays as the honest placeholder when a card type has no Chinese label.
    cardTypeLabels[cardType] = readName(manifestCardTypeLabels[cardType]) || cardType;
  });
  return { toolLabels, cardTypeLabels };
}

function renderAgentLabels() {
  const { toolLabels, cardTypeLabels } = buildAgentLabels();
  return [
    "// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.",
    "// Regenerate: node tools/generate-agent-event-map.js",
    "// TOOL_LABELS keys = manifest.tools; label = manifest.tools[toolId].displayName, then manifest.intents[toolId].displayName, falling back to the tool id when the manifest carries no Chinese name.",
    "// CARD_TYPE_LABELS keys = manifest.cardTypes; label = manifest.cardTypeLabels[cardType], falling back to the card type key when the manifest carries no Chinese label.",
    `const TOOL_LABELS = Object.freeze(${JSON.stringify(toolLabels, null, 2)});`,
    "",
    `const CARD_TYPE_LABELS = Object.freeze(${JSON.stringify(cardTypeLabels, null, 2)});`,
    "",
    "module.exports = {",
    "  TOOL_LABELS,",
    "  CARD_TYPE_LABELS,",
    "};",
    "",
  ].join("\n");
}

function readCurrent(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
}

function main() {
  assertEventMapCoverage();
  const checkOnly = process.argv.includes("--check");
  const pending = [
    { files: aguiEventMapOutputs, source: renderAguiEventMap() },
    { files: agentLabelsOutputs, source: renderAgentLabels() },
  ];
  const stale = [];
  pending.forEach(({ files, source }) => {
    files.forEach((file) => {
      if (readCurrent(file) === source) return;
      stale.push(file);
      if (!checkOnly) fs.writeFileSync(file, source, "utf8");
    });
  });
  if (checkOnly && stale.length) {
    stale.forEach((file) => console.error(`stale: ${path.relative(root, file)}`));
    console.error("Agent event map generated files are stale. Run node tools/generate-agent-event-map.js.");
    process.exit(1);
  }
  console.log(checkOnly ? "agent-event-map: current" : "agent-event-map: generated");
}

main();
