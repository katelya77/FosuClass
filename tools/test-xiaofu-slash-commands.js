#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const slash = require("../miniprogram/services/xiaofuSlashCommand");
const registry = require("../miniprogram/shared/aiCapabilityRegistry.generated");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

function run() {
  slash.resetRecentCommandsForTest();
  const commands = slash.commandCatalog();
  assert(commands.length >= 12, "formal command palette should cover primary campus tasks");
  assert.strictEqual(new Set(commands.map((item) => item.name)).size, commands.length, "slash names must be unique");
  commands.forEach((command) => {
    assert(command.example.startsWith(`/${command.name}`), `example must begin with /${command.name}`);
    assert(registry.AI_CAPABILITY_BY_ID[command.capabilityId], `${command.name} must bind a manifest capability`);
    if (command.name === "teacher") return;
    const resolved = slash.resolveCommand(command.example);
    assert.strictEqual(resolved.valid, true, `${command.example} should resolve`);
    assert(resolved.message && !resolved.message.startsWith("/"), `${command.name} must translate to deterministic tool text`);
    assert.notStrictEqual(toolRegistry.resolveIntent(resolved.message, {}).name, "conversational_help", `${command.name} example must hit a deterministic intent`);
  });
  const teacher = commands.find((item) => item.name === "teacher");
  assert(teacher, "teacher command should exist");
  assert(teacher.example.includes("教师姓名"), "teacher example must use an explicit placeholder");
  assert(!JSON.stringify(commands).includes("陈芳"), "slash command metadata must not expose a real teacher name");
  assert.strictEqual(slash.resolveCommand(teacher.example).valid, false, "teacher placeholder must not be executable");
  const safeTeacher = slash.resolveCommand("/teacher 测试教师 第8周 周三 下午 江湾校区");
  assert.strictEqual(safeTeacher.valid, true, "a replaced teacher placeholder should resolve");
  assert.notStrictEqual(toolRegistry.resolveIntent(safeTeacher.message, {}).name, "conversational_help");
  assert.strictEqual(slash.resolveCommand("/teacher").valid, false, "teacher requires a name");
  assert.strictEqual(slash.resolveCommand("/teacher 第8周").valid, false, "teacher must not accept a temporal token as name");
  assert.strictEqual(slash.resolveCommand("/room 江湾校区").valid, false, "room requires place and time");
  assert.strictEqual(slash.resolveCommand("/weather 仙溪校区").valid, false, "weather requires a date");
  assert.strictEqual(slash.resolveCommand("/unknown").valid, false, "unknown slash command must fail closed");
  assert.deepStrictEqual(slash.resolveCommand("今天有什么课"), { isCommand: false, valid: true, message: "今天有什么课" });
  assert(slash.filterCommands("/").length === commands.length, "bare slash should list every command");
  assert.deepStrictEqual(slash.filterCommands("/teacher").map((item) => item.name), ["teacher"]);
  assert.deepStrictEqual(slash.filterCommands("／老师").map((item) => item.name), ["teacher"]);
  assert.strictEqual(slash.resolveCommand("／today").valid, true, "full-width slash should normalize");
  assert.strictEqual(slash.resolveCommand("/techer 测试教师").canonicalCommand, "/teacher", "unique typo should resolve safely");
  const ambiguous = slash.resolveCommand("/teach");
  assert.strictEqual(ambiguous.valid, false, "ambiguous prefix must not auto execute");
  assert(ambiguous.suggestions.length >= 2, "ambiguous prefix should offer candidates");
  slash.recordRecentCommand("weather");
  slash.recordRecentCommand("teacher");
  assert.deepStrictEqual(slash.readRecentCommandNames(), ["teacher", "weather"], "history stores command ids only");
  const recent = slash.filterCommands("/");
  assert.deepStrictEqual(recent.slice(0, 2).map((item) => item.name), ["teacher", "weather"], "bare slash should rank recent commands first");
  assert(recent.slice(0, 2).every((item) => item.recent), "recent commands should be marked for the palette");
  const contextualDraft = slash.buildCommandDraft(teacher, { lastWeek: 6, lastWeekday: 5, lastTargetName: "不应写入草稿" });
  assert.strictEqual(contextualDraft.value, "/teacher 教师姓名 第6周 周五 下午 江湾校区");
  assert.deepStrictEqual(contextualDraft.reusedContext, ["周次", "星期"]);
  assert(!contextualDraft.value.includes("不应写入草稿"), "command draft must not copy remembered entity names");
  const roomIntent = toolRegistry.resolveIntent(slash.resolveCommand("/room 江湾校区 C7 后天 下午 连续3节").message, {});
  assert.strictEqual(roomIntent.slots.minFreeSections, 3, "building number must not overwrite continuous duration");

  const root = path.resolve(__dirname, "..");
  const wxml = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
  const palette = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/components/xiaofu-command-palette/index.wxml"), "utf8");
  const js = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"), "utf8");
  assert(wxml.includes("xiaofu-command-palette") && wxml.includes("onSlashCommandTap"));
  assert(palette.includes("command-panel") && palette.includes("onSelect"));
  assert(js.includes("resolveCommand(message)"), "send path must resolve commands before online request");
  assert(js.includes("commandResult.suggestions"), "ambiguous commands should keep their targeted suggestions after send");
  assert(!wxml.includes("voice-btn") && !wxml.includes("microphone"), "voice input must remain removed");
  console.log(`test-xiaofu-slash-commands passed (${commands.length} commands)`);
}

run();
