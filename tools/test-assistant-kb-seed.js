const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-assistant-kb-seed-"));
const dataPath = path.join(tempRoot, "knowledge-docs.json");
process.env.FOSU_ASSISTANT_KB_PATH = dataPath;

try {
  const seed = require("./seed-assistant-local-rules");
  const summary = seed.run(["--publish"]);
  assert.strictEqual(summary.publish, true);
  assert(summary.publishedRuleCount >= 18, "published rules should include local-rule seed");
  assert(summary.publishedDocCount >= 10, "published docs should include documentation seed");

  const store = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  assert(store.published && store.published.versionId, "published versionId missing");
  assert(store.published.rules.length >= 18);
  assert(store.published.docs.length >= 10);

  const weather = store.published.rules.find((item) => item.id === "assistant-rule-weather");
  assert(weather, "weather rule missing");
  assert.strictEqual(weather.intentName, "get_campus_weather");
  assert.strictEqual(weather.toolName, "get_campus_weather");
  assert.strictEqual(weather.cardType, "weather");

  const internal = store.published.docs.find((item) => item.id === "assistant-doc-trial-dev-internal");
  assert(internal, "internal trial/dev doc missing");
  assert(!internal.scope.includes("public"), "internal trial/dev doc must not publish to public scope");

  console.log("test-assistant-kb-seed passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
