"use strict";

// Deprecated compatibility entrypoint. Canonical defaults, parsing and execution
// are owned by tools/fosu-sync-client/current-term.js.
const { main } = require("../../tools/fosu-sync-client/current-term");

console.warn("DEPRECATED: use npm run sync:current-term");
process.exitCode = main(process.argv.slice(2));
