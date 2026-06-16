#!/usr/bin/env node

const {
  printDiagnosisSummary,
  probeCampusNetwork,
} = require("./networkProbe");

function parseArgs(argv = []) {
  return argv.reduce((acc, item) => {
    if (!String(item).startsWith("--")) return acc;
    const body = String(item).slice(2);
    const index = body.indexOf("=");
    if (index >= 0) acc[body.slice(0, index)] = body.slice(index + 1);
    else acc[body] = true;
    return acc;
  }, {});
}

async function diagnose(options = {}) {
  const result = await probeCampusNetwork(options);
  if (!options.json) {
    printDiagnosisSummary(result, options.logger || console);
  }
  return result;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  diagnose({
    json: Boolean(args.json),
    publisher: Boolean(args.publisher),
  }).then((result) => {
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    process.exitCode = result.readiness === "blocked" ? 1 : 0;
  }).catch((error) => {
    const payload = {
      success: false,
      readiness: "blocked",
      code: error.code || "CAMPUS_NETWORK_CHECK_FAILED",
      message: error.message,
    };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(`${payload.code}: ${payload.message}`);
    process.exitCode = 1;
  });
}

module.exports = diagnose;
module.exports.parseArgs = parseArgs;
