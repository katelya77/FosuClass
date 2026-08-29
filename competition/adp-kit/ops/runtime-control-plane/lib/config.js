"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DESIRED_ROOT } = require("./desired-state.js");
const { REPO_ROOT } = require("./desired-state.js");

const LOCAL_PATH = path.join(DESIRED_ROOT, "config.local.json");

function loadLocalConfig() {
  let local = {};
  if (fs.existsSync(LOCAL_PATH)) local = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf8"));
  const agentIds = local.agentIds || {};
  let repoCloudBaseEnvId = null;
  const cloudBaseRc = path.join(REPO_ROOT, "cloudbaserc.json");
  if (fs.existsSync(cloudBaseRc)) {
    try { repoCloudBaseEnvId = JSON.parse(fs.readFileSync(cloudBaseRc, "utf8")).envId || null; } catch (_) { repoCloudBaseEnvId = null; }
  }
  return {
    region: process.env.ADP_REGION || local.region || "ap-shanghai",
    appId: process.env.ADP_APP_ID || local.appId || null,
    pluginId: process.env.ADP_PLUGIN_ID || local.pluginId || null,
    agentIds: {
      main: process.env.ADP_AGENT_MAIN_ID || agentIds.main || null,
      schedule: process.env.ADP_AGENT_SCHEDULE_ID || agentIds.schedule || null,
      risk: process.env.ADP_AGENT_RISK_ID || agentIds.risk || null,
      insight: process.env.ADP_AGENT_INSIGHT_ID || agentIds.insight || null,
    },
    cloudBaseEnvId: process.env.TCB_ENV_ID || local.cloudBaseEnvId || repoCloudBaseEnvId,
  };
}

function configCapability(config = loadLocalConfig()) {
  return {
    regionConfigured: Boolean(config.region),
    appIdConfigured: Boolean(config.appId),
    pluginIdConfigured: Boolean(config.pluginId),
    allAgentIdsConfigured: Object.values(config.agentIds).every(Boolean),
    cloudBaseEnvConfigured: Boolean(config.cloudBaseEnvId),
  };
}

module.exports = { LOCAL_PATH, configCapability, loadLocalConfig };
