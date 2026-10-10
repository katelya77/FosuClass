// Preserve the existing CLI defaults and API while sharing the distribution
// implementation with the self-contained server runtime.
module.exports = require("../../server/src/shared/releasePackDistribution")
  .createReleasePackUtils(require("../../miniprogram/config/cloudbase"));
