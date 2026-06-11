const assert = require("assert");
const {
  compareResourceCountContracts,
} = require("../server/src/shared/resourceCountContract");

function contract(overrides = {}) {
  return Object.assign({
    countSchemaVersion: 2,
    term: "2025-2026-2",
    class: { scheduleDocuments: 1, administrativeClasses: 1, aggregateSchedules: 0, courseEvents: 0 },
    teacher: { directoryEntities: 1, directoryEntitiesStatus: "counted", scheduleDocuments: 1, courseEvents: 1, sourceMode: "network-direct" },
    classroom: { directoryEntities: 1, directoryEntitiesStatus: "counted", scheduleDocuments: 1, courseEvents: 1, sourceMode: "network-direct" },
    course: { directoryEntities: 1, directoryEntitiesStatus: "counted", scheduleDocuments: 1, courseEvents: 1, sourceMode: "network-direct" },
    catalog: { colleges: 1, grades: 1, majors: 1 },
    scopeFilters: { grades: ["2025"] },
    coverage: {},
    diagnostics: [],
    derivedFromLegacy: false,
  }, overrides);
}

assert.strictEqual(compareResourceCountContracts(contract(), contract()).allowPublish, true);

let result = compareResourceCountContracts(contract({ countSchemaVersion: 1 }), contract());
assert(result.blockers.some((item) => item.code === "COUNT_CONTRACT_MISMATCH"));

result = compareResourceCountContracts(
  contract({ teacher: Object.assign({}, contract().teacher, { sourceMode: "legacy-derived" }) }),
  contract()
);
assert(result.blockers.some((item) => item.code === "SOURCE_MODE_MISMATCH"));

result = compareResourceCountContracts(
  contract({ scopeFilters: { grades: ["2024"] } }),
  contract({ scopeFilters: { grades: ["2025"] } })
);
assert(result.blockers.some((item) => item.code === "SCOPE_FILTER_MISMATCH"));

result = compareResourceCountContracts(contract(), contract({
  diagnostics: [{ code: "ENTITY_NAME_CONTAMINATED", resource: "teacher", publishable: false, message: "bad" }],
}));
assert(result.blockers.some((item) => item.code === "ENTITY_NAME_CONTAMINATED"));

console.log("test-staging-active-count-comparison passed");
