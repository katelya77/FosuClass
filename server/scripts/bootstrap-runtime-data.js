const { bootstrapRuntimeData } = require("../src/services/runtimeDataBootstrapService");

function run() {
  const result = bootstrapRuntimeData();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    seedFingerprint: result.seedFingerprint,
    copied: result.copied,
    skipped: result.skipped,
  })}\n`);
  return result;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || "RUNTIME_BOOTSTRAP_FAILED",
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
