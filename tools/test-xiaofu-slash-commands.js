#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const slash = require("../miniprogram/services/xiaofuSlashCommand");
const registry = require("../miniprogram/shared/aiCapabilityRegistry.generated");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

function run() {
  const commands = slash.commandCatalog();
  assert(commands.length >= 12, "formal command palette should cover primary campus tasks");
  assert.strictEqual(new Set(commands.map((item) => item.name)).size, commands.length, "slash names must be unique");
  commands.forEach((command) => {
    assert(command.example.startsWith(`/${command.name}`), `example must begin with /${command.name}`);
    assert(registry.AI_CAPABILITY_BY_ID[command.capabilityId], `${command.name} must bind a manifest capability`);
    const resolved = slash.resolveCommand(command.example);
    assert.strictEqual(resolved.valid, true, `${command.example} should resolve`);
    assert(resolved.message && !resolved.message.startsWith("/"), `${command.name} must translate to deterministic tool text`);
    assert.notStrictEqual(toolRegistry.resolveIntent(resolved.message, {}).name, "conversational_help", `${command.name} example must hit a deterministic intent`);
  });
  assert.strictEqual(slash.resolveCommand("/teacher").valid, false, "teacher requires a name");
  assert.strictEqual(slash.resolveCommand("/teacher 第8周").valid, false, "teacher must not accept a temporal token as name");
  assert.strictEqual(slash.resolveCommand("/room 江湾校区").valid, false, "room requires place and time");
  assert.strictEqual(slash.resolveCommand("/weather 仙溪校区").valid, false, "weather requires a date");
  assert.strictEqual(slash.resolveCommand("/unknown").valid, false, "unknown slash command must fail closed");
  assert.deepStrictEqual(slash.resolveCommand("今天有什么课"), { isCommand: false, valid: true, message: "今天有什么课" });
  assert(slash.filterCommands("/").length === commands.length, "bare slash should list every command");
  assert.deepStrictEqual(slash.filterCommands("/teacher").map((item) => item.name), ["teacher"]);
  const roomIntent = toolRegistry.resolveIntent(slash.resolveCommand("/room 江湾校区 C7 后天 下午 连续3节").message, {});
  assert.strictEqual(roomIntent.slots.minFreeSections, 3, "building number must not overwrite continuous duration");

  const root = path.resolve(__dirname, "..");
  const wxml = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
  const palette = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/components/xiaofu-command-palette/index.wxml"), "utf8");
  const js = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"), "utf8");
  assert(wxml.includes("xiaofu-command-palette") && wxml.includes("onSlashCommandTap"));
  assert(palette.includes("command-panel") && palette.includes("onSelect"));
  assert(js.includes("resolveCommand(message)"), "send path must resolve commands before online request");
  assert(!wxml.includes("voice-btn") && !wxml.includes("microphone"), "voice input must remain removed");
  console.log(`test-xiaofu-slash-commands passed (${commands.length} commands)`);
}

run();
