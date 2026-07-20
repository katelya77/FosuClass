#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "server", "config", "agent-capability-manifest.json");
const outputPath = path.join(root, "miniprogram", "shared", "agentCapabilityCompat.generated.js");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function render() {
  return [
    "// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.",
    `const MANIFEST_SCHEMA_VERSION = ${JSON.stringify(manifest.schemaVersion)};`,
    `const PROTOCOL_VERSIONS = Object.freeze(${JSON.stringify(manifest.protocolVersions, null, 2)});`,
    `const CANONICAL_INTENTS = Object.freeze(${JSON.stringify(Object.keys(manifest.intents), null, 2)});`,
    `const OFFLINE_INTENT_MAP = Object.freeze(${JSON.stringify(manifest.clientCompatibility, null, 2)});`,
    "",
    "function toCanonicalIntent(intentName) {",
    "  const value = String(intentName || \"\");",
    "  return CANONICAL_INTENTS.indexOf(value) >= 0 ? value : (OFFLINE_INTENT_MAP[value] || \"clarify_missing_slot\");",
    "}",
    "",
    "module.exports = {",
    "  CANONICAL_INTENTS,",
    "  MANIFEST_SCHEMA_VERSION,",
    "  OFFLINE_INTENT_MAP,",
    "  PROTOCOL_VERSIONS,",
    "  toCanonicalIntent,",
    "};",
    "",
  ].join("\n");
}

const generated = render();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== generated) {
    console.error("agent capability client artifact is out of date");
    process.exit(1);
  }
  console.log("agent capability client artifact is current");
} else {
  fs.writeFileSync(outputPath, generated, "utf8");
  console.log(`generated ${path.relative(root, outputPath)}`);
}
