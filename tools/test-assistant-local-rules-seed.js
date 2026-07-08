const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-assistant-rules-seed-"));
process.env.FOSU_ASSISTANT_KB_PATH = path.join(tempRoot, "knowledge-docs.json");

try {
  const seed = require("./seed-assistant-local-rules");
  const built = seed.buildSeedEntries();
  assert(built.rules.length >= 18, "seed must include at least 18 local rules");
  assert(built.docs.length >= 10, "seed must include at least 10 knowledge docs");

  const requiredRules = [
    "assistant-rule-capability-intro",
    "assistant-rule-today-schedule",
    "assistant-rule-tomorrow-schedule",
    "assistant-rule-next-course",
    "assistant-rule-week-schedule",
    "assistant-rule-class-schedule",
    "assistant-rule-teacher-schedule",
    "assistant-rule-classroom-schedule",
    "assistant-rule-course-schedule",
    "assistant-rule-empty-room",
    "assistant-rule-continuous-empty-room",
    "assistant-rule-teaching-week",
    "assistant-rule-term-calendar",
    "assistant-rule-weather",
    "assistant-rule-campus-map",
    "assistant-rule-personal-import",
    "assistant-rule-data-status",
    "assistant-rule-privacy",
    "assistant-rule-clarify",
  ];
  const ids = new Set(built.rules.map((item) => item.id));
  requiredRules.forEach((id) => assert(ids.has(id), `missing required rule ${id}`));

  built.rules.forEach((item) => {
    assert(item.intentName, `${item.id} must include intentName`);
    assert(Array.isArray(item.scope) && item.scope.includes("public") && item.scope.includes("trial") && item.scope.includes("dev"), `${item.id} must cover public/trial/dev`);
    assert(Array.isArray(item.keywords) && item.keywords.length > 0, `${item.id} must include keywords`);
    assert(Number(item.priority) > 0, `${item.id} must include priority`);
    assert(item.cardType !== undefined, `${item.id} must include cardType`);
  });

  const publicText = built.rules
    .filter((item) => (item.scope || []).includes("public"))
    .map((item) => `${item.title}\n${item.body}\n${item.reply || ""}`)
    .join("\n");
  assert(!/(Provider|DeepSeek|Coze|CloudBase|Prompt|Token|Release Pack)/i.test(publicText), "public rules must not expose internal terms");

  const dryRun = seed.run(["--dry-run"]);
  assert.strictEqual(dryRun.dryRun, true);
  assert.strictEqual(dryRun.publish, false);
  assert(dryRun.seedRuleCount >= 18);
  assert(dryRun.seedDocCount >= 10);

  console.log("test-assistant-local-rules-seed passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
