const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function ignored(filePath) {
  try {
    git(["check-ignore", filePath]);
    return true;
  } catch (error) {
    return false;
  }
}

assert(ignored("tools/fosu-sync-client/.cache/test.json"), ".cache files must be ignored");
assert(ignored("tools/fosu-sync-client/.debug/test.json"), ".debug files must be ignored");
assert(ignored("tools/fosu-sync-client/.session/session.json"), ".session files must be ignored");
assert(ignored("tools/fosu-sync-client/staging/test.json"), "sync-client staging files must be ignored");
assert(ignored("staging/test.json"), "root staging files must be ignored");
assert(ignored("sample.har"), "HAR files must be ignored");
assert(ignored("sample.log"), "log files must be ignored");
assert(!ignored("tools/fixtures/sanitized-sync-sample.json"), "sanitized fixture path should remain trackable");

const cached = git(["diff", "--cached", "--name-only"]);
[
  "tools/fosu-sync-client/.cache/",
  "tools/fosu-sync-client/.debug/",
  "tools/fosu-sync-client/.session/",
  "tools/fosu-sync-client/staging/",
  "staging/",
].forEach((needle) => {
  assert(!cached.includes(needle), `staged changes must not include ${needle}`);
});

const fixturesDir = path.join(root, "tools", "fixtures");
if (fs.existsSync(fixturesDir)) {
  const largeFixtures = fs.readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(fixturesDir, name))
    .filter((filePath) => fs.statSync(filePath).size > 1024 * 1024);
  assert.strictEqual(largeFixtures.length, 0, "fixtures must not contain real timetable-size JSON files");
}

console.log("test-generated-artifacts-gitignore passed");
