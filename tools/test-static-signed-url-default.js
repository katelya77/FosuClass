const assert = require("assert");
const path = require("path");

const configPath = path.join(__dirname, "..", "server", "src", "config.js");
delete process.env.STATIC_SIGNED_URL_ENABLED;
delete require.cache[require.resolve(configPath)];
let config = require(configPath);
assert.strictEqual(config.STATIC_SIGNED_URL_ENABLED, false, "static signed URL support should be disabled by default");

process.env.STATIC_SIGNED_URL_ENABLED = "true";
delete require.cache[require.resolve(configPath)];
config = require(configPath);
assert.strictEqual(config.STATIC_SIGNED_URL_ENABLED, true, "static signed URL support should only enable explicitly");

console.log("test-static-signed-url-default passed");
