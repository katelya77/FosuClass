const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"), "utf-8");

[
  "sync-section-nav",
  "sync-ops-console",
  "sync-pending-panel",
  "sync-active-panel",
  "release-history-panel",
  "staging-cli-upload-panel",
  "sync-command-accordion",
  "sync-technical-details",
].forEach((needle) => assert(source.includes(needle), `missing responsive sync IA element: ${needle}`));

assert(source.includes("overflow-x: auto"), "long technical content should be locally scrollable");
assert(source.includes("minmax(220px, 1fr)"), "operation cards should use responsive grid tracks");
assert(source.includes("Published 不等于 Active"), "release and runtime states should be visually separated");
assert(source.includes("id=\"syncActiveResourceContract\""), "active contract panel should be present");
assert(source.includes("id=\"syncPendingCards\""), "pending card panel should be present");

console.log("test-admin-responsive-layout passed");
