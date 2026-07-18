const { bootstrapRuntimeData } = require("../src/services/runtimeDataBootstrapService");

try {
  const result = bootstrapRuntimeData();
  process.stdout.write(`${JSON.stringify({
    event: "runtime-data-bootstrap",
    seedFingerprint: result.seedFingerprint,
    copied: result.copied,
    skippedCount: result.skipped.length,
  })}\n`);
  const app = require("../src/app");
  app.startServer();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    event: "runtime-start-failed",
    code: error.code || "RUNTIME_START_FAILED",
    message: error.message,
  })}\n`);
  process.exit(1);
}
