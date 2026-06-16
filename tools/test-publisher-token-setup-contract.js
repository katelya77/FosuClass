const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const setup = fs.readFileSync(path.join(root, "tools", "fosu-publisher", "setup-admin-token.ps1"), "utf8");

assert.strictEqual(packageJson.scripts["publisher:token:setup"], "powershell -NoProfile -ExecutionPolicy Bypass -File tools/fosu-publisher/setup-admin-token.ps1");
assert.strictEqual(packageJson.scripts["publisher:token:verify"], "node tools/fosu-publisher/verify-admin-token.js");
assert.strictEqual(packageJson.scripts["publisher:token:status"], "node tools/fosu-publisher/verify-admin-token.js --status");

assert(setup.includes("[Environment]::GetEnvironmentVariable(\"ADMIN_API_TOKEN\", \"User\")"), "setup should read Windows User ADMIN_API_TOKEN");
assert(setup.includes("[Environment]::SetEnvironmentVariable(\"ADMIN_API_TOKEN\", $Token, \"User\")"), "setup should set Windows User ADMIN_API_TOKEN");
assert(setup.includes("RandomNumberGenerator"), "setup should generate secure random token");
assert(setup.includes("$Rotate"), "setup should require explicit rotate flag before generating a new token");
assert(setup.includes("secret set ADMIN_API_TOKEN"), "setup should set the GitHub Actions secret by name");
assert(setup.includes("$Token | & $GhPath secret set ADMIN_API_TOKEN"), "setup should pass token to gh through stdin");
assert(!/secret set ADMIN_API_TOKEN[^\n\r]*(--body|-b)\s+\$Token/.test(setup), "setup must not pass the token as a gh command-line argument");
assert(!/Write-(Host|Output|Information)[^\n\r]*\$Token/.test(setup), "setup must not print the token");
assert(setup.includes("Set-Clipboard"), "setup should allow explicit clipboard copy when gh is unavailable");
assert(setup.includes("https://github.com/katelya77/FosuClass/settings/secrets/actions"), "setup should print the GitHub web secret path");

console.log("test-publisher-token-setup-contract passed");
