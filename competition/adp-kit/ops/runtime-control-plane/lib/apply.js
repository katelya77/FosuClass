"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { redactDeep } = require("./redact.js");

const ALLOWED_ACTIONS = new Set(["ModifyAgent", "ModifyPlugin", "ModifyApp"]);
const ALLOWED_MASKS = {
  ModifyAgent: new Set(["Instructions", "ToolList", "PluginList", "Model"]),
  ModifyPlugin: new Set(["ToolList", "Description"]),
  ModifyApp: new Set(["Name", "Description", "Model"]),
};

function validatePlan(plan) {
  for (const item of plan || []) {
    if (!ALLOWED_ACTIONS.has(item.action)) throw new Error(`forbidden action: ${item.action}`);
    if (!Array.isArray(item.updateMask) || item.updateMask.length === 0) throw new Error(`UpdateMask required for ${item.action}`);
    for (const mask of item.updateMask) {
      if (!ALLOWED_MASKS[item.action].has(mask)) throw new Error(`UpdateMask path not allowlisted: ${mask}`);
    }
  }
}

async function applySafePlan({ plan = [], client, safe = false, confirm = false, rollbackPath }) {
  validatePlan(plan);
  if (!safe || !confirm) return { mode: "dry-run", applied: 0, plan: redactDeep(plan) };
  if (!client) throw new Error("ADP client unavailable");
  if (!rollbackPath) throw new Error("rollback snapshot path required");
  const before = await client.snapshot();
  fs.mkdirSync(path.dirname(rollbackPath), { recursive: true });
  fs.writeFileSync(rollbackPath, `${JSON.stringify(redactDeep(before), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  let applied = 0;
  for (const item of plan) {
    const method = item.action === "ModifyAgent" ? "modifyAgent" : item.action === "ModifyPlugin" ? "modifyPlugin" : "modifyApp";
    if (typeof client[method] !== "function") throw new Error(`${item.action} client method unavailable`);
    await client[method]({ ...item.patch, Target: item.target, UpdateMask: { Paths: item.updateMask.slice() } });
    applied += 1;
  }
  return { mode: "safe", applied, rollbackPath };
}

module.exports = { ALLOWED_ACTIONS, ALLOWED_MASKS, applySafePlan, validatePlan };
