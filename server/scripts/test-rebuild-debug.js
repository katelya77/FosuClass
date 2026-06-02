const releaseService = require("../src/services/releaseService");
try {
  const version = "26.05.29.22";
  console.log("1. clearDerivedCache");
  releaseService.clearDerivedCache();
  
  console.log("2. getReleaseFiles");
  const files = releaseService.getReleaseFiles(version);
  
  console.log("3. readReleaseSnapshot");
  const snapshot = releaseService.readReleaseSnapshot(version);
  if (!snapshot) {
    console.log("快照不存在");
    process.exit(0);
  }
} catch (e) {
  console.error("致命错误:", e);
}
