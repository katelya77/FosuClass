const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { createSkillCatalog } = require("../packages/skill-runtime");
const { createToolRuntime } = require("../packages/tool-runtime");
const { blocksFromAgentResult } = require("../packages/ui-schema");
const { createFosuCampusPlugin } = require("../plugins/fosu-campus");
const capabilityManifestService = require("../server/src/services/ai/capabilityManifestService");
const skillRegistry = require("../server/src/services/ai/skillRegistry");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const toolSchemaRegistry = require("../server/src/services/ai/generated/toolSchemas.generated");
const responseComposer = require("../server/src/services/ai/responseComposer");
const releaseService = require("../server/src/services/releaseService");

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

async function main() {
  const plugin = createFosuCampusPlugin({
    capabilityManifestService,
    skillRegistry,
    toolRegistry,
    toolSchemaRegistry,
    responseComposer,
    releaseService,
    mapResultToBlocks: blocksFromAgentResult,
  });

  await test("Plugin is an immutable snapshot of the authoritative Manifest", async () => {
    const manifest = capabilityManifestService.getManifest();
    assert.strictEqual(plugin.id, "fosu-campus");
    assert.strictEqual(plugin.manifestVersion, manifest.schemaVersion);
    assert(Object.isFrozen(plugin));
    assert(Object.isFrozen(plugin.skills));
    assert(Object.isFrozen(plugin.tools));
    assert.deepStrictEqual(
      plugin.tools.map((tool) => tool.id),
      toolRegistry.listToolNames(),
    );
    assert.deepStrictEqual(
      plugin.skills.map((skill) => skill.id).sort(),
      skillRegistry.listSkills().map((skill) => skill.id).sort(),
    );
    assert.strictEqual(new Set(plugin.tools.map((tool) => tool.id)).size, plugin.tools.length);
    assert.strictEqual(new Set(plugin.skills.map((skill) => skill.id)).size, plugin.skills.length);
  });

  await test("Plugin descriptors feed the generic Skill and Tool runtimes", async () => {
    const skills = createSkillCatalog({ skills: plugin.skills });
    const tools = createToolRuntime({ tools: plugin.tools });
    const intent = capabilityManifestService.getIntent("explain_personal_import");
    const skill = skills.get(intent.skill);
    assert(skill);

    const allToolIds = plugin.tools.map((tool) => tool.id);
    const allowedToolIds = tools.resolveAllowedToolIds({
      manifestToolIds: intent.allowedTools,
      skillToolIds: skill.allowedTools,
      runtimeToolIds: allToolIds,
      environmentToolIds: allToolIds,
      safetyToolIds: allToolIds,
    });
    assert.deepStrictEqual(allowedToolIds, ["explain_personal_import"]);

    const result = await tools.execute("explain_personal_import", {}, {
      runtimeMode: "public",
    }, { allowedToolIds });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.title, "个人课表导入说明");
    assert(Array.isArray(result.steps));
  });

  await test("Release context and UI mapping expose only stable public data", async () => {
    const context = plugin.getReleaseContext();
    assert.deepStrictEqual(Object.keys(context).sort(), [
      "active",
      "releaseVersion",
      "term",
      "updatedAt",
    ]);
    assert(!JSON.stringify(context).includes("storagePath"));
    const blocks = plugin.mapResultToBlocks({ answer: "已返回导入指引", cards: [] });
    assert.strictEqual(blocks[0].type, "text");
  });

  await test("Plugin does not copy the authoritative capability Manifest", async () => {
    const copied = listFiles(path.join(__dirname, "..", "plugins", "fosu-campus"))
      .filter((file) => path.basename(file) === "agent-capability-manifest.json");
    assert.deepStrictEqual(copied, []);
  });

  console.log(`fosu-campus-plugin: pass=${passed} fail=0`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
