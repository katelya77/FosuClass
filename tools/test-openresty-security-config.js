const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const configPath = path.join(root, "deploy", "openresty", "fosu-static-security.conf");
const docsPath = path.join(root, "docs", "openresty-static-security.md");

const conf = fs.readFileSync(configPath, "utf-8");
const docs = fs.readFileSync(docsPath, "utf-8");

assert(conf.includes("location ^~ /static/releases/"), "include should scope static release location");
assert(!/^\s*server\s*\{/m.test(conf), "include must not define or overwrite a full server block");
assert(conf.includes("limit_except GET HEAD"), "include should restrict methods to GET/HEAD");
assert(conf.includes("autoindex off"), "include should disable directory listing");
assert(conf.includes("\\.git"), "include should deny .git");
assert(conf.includes("bak") && conf.includes("sql") && conf.includes("map"), "include should deny backup/source-map style files");
assert(conf.includes("%2e%2e") && conf.includes("%252e"), "include should reject traversal and double encoding");
assert(docs.includes("Capability check"), "docs should include capability check guidance");
assert(docs.includes("FOSU_SECURITY_MODE=observe"), "docs should include rollback mode");

console.log("test-openresty-security-config passed");
