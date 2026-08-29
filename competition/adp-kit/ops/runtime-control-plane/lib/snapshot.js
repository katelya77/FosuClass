"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { CONTROL_ROOT, hashText } = require("./desired-state.js");
const { configCapability, loadLocalConfig } = require("./config.js");
const { commandExists, run } = require("./process.js");
const { redactDeep } = require("./redact.js");

const SNAPSHOT_PATH = path.join(CONTROL_ROOT, "snapshots", "current.local.json");
const SUMMARY_PATH = path.join(CONTROL_ROOT, "CURRENT-STATE-SUMMARY.md");

function tccliJson(action, body, config) {
  const args = ["adp", action, "--Region", config.region, "--cli-input-json", JSON.stringify(body)];
  const result = run("tccli", args);
  if (result.status !== 0) throw new Error(`${action} failed without credential output`);
  return JSON.parse(result.stdout);
}

function tcbApiJson(action, body) {
  const result = run("tcb", ["api", "adp", action, "--api-version", "2026-05-20", "--body", JSON.stringify(body), "--json"]);
  if (result.status !== 0) throw new Error(`${action} failed without credential output`);
  return JSON.parse(result.stdout);
}

function adpRead(action, body, config) {
  if (commandExists("tccli")) return tccliJson(action, body, config);
  if (commandExists("tcb")) return tcbApiJson(action, body);
  throw new Error("Tencent ADP read client unavailable");
}

function normalizeAgent(key, raw) {
  const detail = raw.Agent || raw.AgentDetail || raw.Data || raw;
  const instructions = detail.Instructions || detail.Instruction || detail.Prompt || "";
  const toolList = detail.ToolList || detail.Tools || [];
  const campusTools = toolList.map((tool) => typeof tool === "string" ? tool : tool.OperationId || tool.Name).filter((name) => /^campus_/.test(name || ""));
  const visionBound = toolList.some((tool) => /vision|image|图片|视觉/i.test(typeof tool === "string" ? tool : `${tool.Name || ""} ${tool.Type || ""}`));
  return {
    key,
    promptHash: hashText(String(instructions)),
    campusTools,
    officialVisionToolBound: visionBound,
    model: detail.ModelName || (detail.Model && (detail.Model.Name || detail.Model.ModelName)) || null,
  };
}

function snapshotFromInput(input) {
  const clean = redactDeep(input);
  if (typeof clean.observed !== "boolean") clean.observed = true;
  return clean;
}

function takeAdpSnapshot(options = {}) {
  if (options.input) return snapshotFromInput(JSON.parse(fs.readFileSync(options.input, "utf8")));
  const config = loadLocalConfig();
  const capability = configCapability(config);
  if ((!commandExists("tccli") && !commandExists("tcb")) || !capability.appIdConfigured || !capability.pluginIdConfigured || !capability.allAgentIdsConfigured) {
    return {
      observed: false,
      status: "BLOCKED_UNKNOWN",
      reason: (!commandExists("tccli") && !commandExists("tcb")) ? "TENCENT_CLOUD_API_CLIENT_UNAVAILABLE" : "LOCAL_NON_SECRET_IDS_INCOMPLETE",
      capability,
    };
  }
  const app = adpRead("DescribeApp", { AppBizId: config.appId }, config);
  const agents = Object.entries(config.agentIds).map(([key, AgentBizId]) => normalizeAgent(key, adpRead("DescribeAgentDetail", { AppBizId: config.appId, AgentBizId }, config)));
  const plugin = adpRead("DescribePlugin", { PluginBizId: config.pluginId }, config);
  const appData = app.App || app.Data || app;
  const pluginData = plugin.Plugin || plugin.PluginDetail || plugin.Data || plugin;
  const toolList = pluginData.ToolList || [];
  return redactDeep({
    observed: true,
    source: "Tencent ADP official read-only API",
    app: {
      mode: appData.Mode || appData.AppMode || null,
      published: Boolean(appData.Published || appData.IsPublished),
      model: appData.ModelName || null,
    },
    agents,
    plugin: { operationIds: toolList.map((x) => x.OperationId || x.Name).filter(Boolean) },
    legacyWorkflowActive: null,
  });
}

function writeSnapshot(snapshot, file = SNAPSHOT_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(redactDeep(snapshot), null, 2)}\n`, "utf8");
  return file;
}

function renderSummary(snapshot) {
  const agents = snapshot.observed ? (snapshot.agents || []) : [];
  const main = agents.find((x) => x.key === "main");
  const lines = [
    "# Current ADP State Summary",
    "",
    `- Snapshot status: **${snapshot.observed ? "OBSERVED" : "BLOCKED/UNKNOWN"}**`,
    `- Source: ${snapshot.source || "No authenticated ADP read client and complete local IDs"}`,
    `- App mode: ${snapshot.observed ? (snapshot.app.Mode || snapshot.app.mode || "UNKNOWN") : "UNKNOWN"}`,
    `- Agent count: ${snapshot.observed ? agents.length : "UNKNOWN"}`,
    `- Prompt hashes: ${snapshot.observed ? "captured (hash only)" : "UNKNOWN"}`,
    `- Main CampusTools: ${main ? main.campusTools.length : "UNKNOWN"}`,
    `- Plugin operations: ${snapshot.observed ? ((snapshot.plugin && snapshot.plugin.operationIds || []).length) : "UNKNOWN"}`,
    `- Main official vision tool: ${main ? (main.officialVisionToolBound ? "BOUND" : "NOT_BOUND") : "UNKNOWN"}`,
    `- Legacy workflow active: ${snapshot.legacyWorkflowActive === true ? "YES" : snapshot.legacyWorkflowActive === false ? "NO" : "UNKNOWN"}`,
    "- Secret values stored: NO",
    "- Publication performed: NO",
    "",
    snapshot.observed ? "Run `npm run adp:diff` to compare this snapshot with Desired State." : "Configure ignored `desired-state/config.local.json` and install/authenticate a Tencent Cloud CLI with ADP support, then rerun `npm run adp:snapshot`.",
  ];
  return `${lines.join("\n")}\n`;
}

function writeSummary(snapshot, file = SUMMARY_PATH) {
  fs.writeFileSync(file, renderSummary(snapshot), "utf8");
  return file;
}

module.exports = { SNAPSHOT_PATH, SUMMARY_PATH, adpRead, normalizeAgent, renderSummary, snapshotFromInput, takeAdpSnapshot, writeSnapshot, writeSummary };
