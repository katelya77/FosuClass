#!/usr/bin/env node

const {
  verifySession,
} = require("./sessionVerifier");

async function main() {
  const result = await verifySession({ headless: true });
  if (result.ok) {
    console.log("SESSION_VALID");
    return 0;
  }
  console.error(JSON.stringify({
    ok: false,
    code: result.code || "SESSION_EXPIRED",
    message: result.message || "Session 已失效，请运行 npm run login",
  }, null, 2));
  return 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || "SESSION_EXPIRED",
      message: error.message || "Session 已失效，请运行 npm run login",
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
