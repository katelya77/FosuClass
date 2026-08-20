"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONTROL_ROOT = path.join(__dirname, "..");
const ADP_ROOT = path.join(CONTROL_ROOT, "..", "..");
const REPO_ROOT = path.join(ADP_ROOT, "..", "..");
const DESIRED_ROOT = path.join(CONTROL_ROOT, "desired-state");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashText(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function posixRelative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function loadDesiredState() {
  const app = readJson(path.join(DESIRED_ROOT, "app.json"));
  const runtime = readJson(path.join(DESIRED_ROOT, "runtime.json"));
  const agentDefs = readJson(path.join(DESIRED_ROOT, "agents.json"));
  const toolState = readJson(path.join(DESIRED_ROOT, "campus-tools.json"));
  const knowledgeState = readJson(path.join(DESIRED_ROOT, "knowledge-current.json"));
  const kbRoot = path.join(ADP_ROOT, "knowledge", "current");
  const documents = fs.readdirSync(kbRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => posixRelative(path.join(kbRoot, entry.name)))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  const declaredDocuments = knowledgeState.documents.slice().sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (JSON.stringify(documents) !== JSON.stringify(declaredDocuments)) throw new Error("knowledge/current desired-state manifest drift");
  const agents = agentDefs.map((agent) => {
    const promptPath = path.join(REPO_ROOT, ...agent.promptSource.split("/"));
    const campusTools = toolState.bindings[agent.key] || [];
    return {
      ...agent,
      campusTools: campusTools.slice(),
      promptHash: hashText(fs.readFileSync(promptPath, "utf8")),
    };
  });
  const bindings = [];
  for (const [agent, tools] of Object.entries(toolState.bindings)) {
    for (const operationId of tools) bindings.push({ agent, operationId });
  }
  return {
    app,
    agents,
    campusTools: toolState.operationIds.slice(),
    bindings,
    widget: runtime.widget,
    multimodal: runtime.multimodal,
    cloudBase: runtime.cloudBase,
    invariants: runtime.invariants,
    knowledge: { root: knowledgeState.root, documents: knowledgeState.documents.slice() },
  };
}

function makeSyntheticMatchingSnapshot(state = loadDesiredState()) {
  return {
    observed: true,
    app: { mode: "preview", published: false },
    agents: state.agents.map((x) => ({
      key: x.key,
      promptHash: x.promptHash,
      campusTools: x.campusTools.slice(),
      officialVisionToolBound: x.key === "main",
    })),
    plugin: { operationIds: state.campusTools.slice() },
    widget: { name: state.widget.name, widgetId: state.widget.widgetId },
    knowledge: { documents: state.knowledge.documents.slice() },
    releaseRequested: false,
  };
}

module.exports = { ADP_ROOT, CONTROL_ROOT, DESIRED_ROOT, REPO_ROOT, hashText, loadDesiredState, makeSyntheticMatchingSnapshot };
