const assert = require("assert");
const fs = require("fs");
const path = require("path");

const adminPath = path.join(__dirname, "../server/src/routes/admin.js");
const source = fs.readFileSync(adminPath, "utf8");
const re = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)/g;
const counts = new Map();
let match;
while ((match = re.exec(source))) {
  const key = `${match[1].toUpperCase()} ${match[2]}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}
const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
assert.deepStrictEqual(duplicates, [], `duplicate routes: ${JSON.stringify(duplicates)}`);
assert.strictEqual((source.match(/router\.get\(\s*["'`]\/sync\/status/g) || []).length, 1, "exactly one GET /sync/status");
console.log("Duplicate route test passed.", { uniqueRoutes: counts.size });
