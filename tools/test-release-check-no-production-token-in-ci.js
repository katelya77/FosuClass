const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "tools", "release-check.js"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-vps.yml"), "utf8");

assert(source.includes("getPublisherAdminToken"), "release check should use shared publisher token discovery");
assert(source.includes("externalBlocked"), "release check should mark external checks as blocked in CI without production credentials");
assert(source.includes("请关闭并重新打开 PowerShell，或设置当前进程环境变量。"), "release check should explain stale Windows User environment variables");
assert(source.includes("isCiEnvironment"), "release check should distinguish GitHub CI from local release gates");
const preflightStart = source.indexOf("function preflight()");
const experienceStart = source.indexOf("function publisherTokenGate()");
const preflightBody = source.slice(preflightStart, experienceStart);
assert(!preflightBody.includes("ADMIN_API_TOKEN"), "release preflight must not require production ADMIN_API_TOKEN");
assert(workflow.includes("npm run release:preflight"), "CI should run release preflight");
assert(!workflow.includes("npm run release:experience:check"), "CI should not run live experience checks without production credentials");

console.log("test-release-check-no-production-token-in-ci passed");
