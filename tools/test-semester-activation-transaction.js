const assert = require("assert");
const service = require("../server/src/services/semesterActivationTransactionService");
assert.strictEqual(typeof service.activateTerm, "function");
assert.strictEqual(typeof service.backupState, "function");
assert.strictEqual(typeof service.restoreState, "function");
console.log("test-semester-activation-transaction passed");
