const assert = require("assert");

const toolRegistry = require("../server/src/services/ai/toolRegistry");

function parseSectionRange(value) {
  const match = String(value || "").match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  assert(match, `invalid sections: ${value}`);
  return [Number(match[1]), Number(match[2] || match[1])];
}

function run() {
  const context = {
    clientLocalTime: "2026-06-08T18:20:00+08:00",
    clientTime: "2026-06-08T10:20:00.000Z",
    timezoneOffsetMinutes: -480,
  };

  const localDate = toolRegistry.parseClientDate(context);
  const section = toolRegistry.getCurrentSection(localDate);
  assert(section >= 8, `18:20 +08:00 should be evening-local section, not UTC 10:20; got ${section}`);

  assert.strictEqual(
    toolRegistry.inferTargetDate("明天上午找空教室", context),
    "2026-06-09",
    "tomorrow should be based on client local date"
  );
  assert.strictEqual(toolRegistry.inferSections("明天上午找空教室", context), "1-4");

  const tonight = toolRegistry.inferSections("今晚连续两节空教室", context);
  const [start, end] = parseSectionRange(tonight);
  assert(start >= 9, `tonight should use evening section range, got ${tonight}`);
  assert(end - start + 1 >= 2, `tonight continuous two sections expected, got ${tonight}`);

  console.log("test-ai-local-time-section passed");
}

run();
