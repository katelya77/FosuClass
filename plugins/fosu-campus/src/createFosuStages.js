function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requirePort(ports, name) {
  if (!ports || typeof ports[name] !== "function") {
    throw codedError("FOSU_STAGE_PORT_REQUIRED", name);
  }
}

function createFosuStages(options = {}) {
  const plugin = options.plugin;
  const ports = options.ports;
  if (!plugin || plugin.id !== "fosu-campus") throw codedError("FOSU_STAGE_PLUGIN_INVALID");
  ["context", "decision", "skillTool", "verification", "response"].forEach((name) => requirePort(ports, name));
  const skillIds = new Set(plugin.skills.map((skill) => skill.id));
  const toolIds = new Set(plugin.tools.map((tool) => tool.id));

  async function assembleContext(input) {
    const output = await ports.context(Object.assign({}, input, {
      plugin,
      releaseContext: plugin.getReleaseContext(),
    }));
    return Object.assign({}, output, {
      pluginId: plugin.id,
      releaseContext: output && output.releaseContext || plugin.getReleaseContext(),
    });
  }

  async function decide(input) {
    const output = await ports.decision(Object.assign({}, input, { plugin }));
    const selectedSkillId = String(output && output.selectedSkillId || "");
    if (selectedSkillId && !output.skipped && !skillIds.has(selectedSkillId)) {
      throw codedError("FOSU_STAGE_SKILL_NOT_IN_PLUGIN", selectedSkillId);
    }
    return output;
  }

  async function executeSkillTool(input) {
    const output = await ports.skillTool(Object.assign({}, input, { plugin }));
    (Array.isArray(output && output.toolCalls) ? output.toolCalls : []).forEach((call) => {
      const toolId = String(call && (call.toolId || call.toolName || call.name) || "");
      if (toolId && !toolIds.has(toolId)) throw codedError("FOSU_STAGE_TOOL_NOT_IN_PLUGIN", toolId);
    });
    return output;
  }

  async function verify(input) {
    const output = await ports.verification(Object.assign({}, input, { plugin }));
    if (!output || typeof output.ok !== "boolean") throw codedError("FOSU_STAGE_VERIFICATION_INVALID");
    return output;
  }

  async function compose(input) {
    const output = await ports.response(Object.assign({}, input, { plugin }));
    if (!output || typeof output !== "object") throw codedError("FOSU_STAGE_RESPONSE_INVALID");
    return output;
  }

  return Object.freeze({
    assembleContext,
    decide,
    executeSkillTool,
    verify,
    compose,
  });
}

module.exports = {
  createFosuStages,
};
