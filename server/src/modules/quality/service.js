const repository = require("./repository");
const { buildQualityReport } = require("./reportService");
const jobService = require("../../services/jobService");

function listIgnores() { return repository.readIgnoreDocument(); }
function prepareMarkIgnoreMutation(rule, options) { return repository.prepareIgnoreMutation({ ...rule, action: "mark" }, options); }
function prepareUnmarkIgnoreMutation(fingerprint, options) { return repository.prepareIgnoreMutation({ action: "unmark", fingerprint }, options); }
function commitPreparedQualityMutation(prepared) { return repository.commitPreparedIgnoreMutation(prepared); }
function markIgnore(rule, options) { return commitPreparedQualityMutation(prepareMarkIgnoreMutation(rule, options)); }
function unmarkIgnore(fingerprint, options) { return commitPreparedQualityMutation(prepareUnmarkIgnoreMutation(fingerprint, options)); }

function startQualityRecheck(input = {}) {
  return jobService.createSingletonJob("quality-recheck", input, async (context) => {
    context.progress(20, "quality report started");
    // Yield after the queued record is persisted so a second request observes
    // the singleton lock instead of racing a synchronous report calculation.
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (process.env.FOSU_QUALITY_RECHECK_TEST_FAIL === "true") {
      const error = new Error("injected quality recheck failure");
      error.code = "QUALITY_RECHECK_INJECTED_FAILURE";
      throw error;
    }
    const report = buildQualityReport();
    context.progress(90, "quality report completed");
    return { activeCount: report.summary.activeCount, ignoredCount: report.summary.ignoredCount, totalCount: report.summary.totalCount, generatedAt: report.generatedAt };
  }, { lockGroup: "quality-recheck" });
}

function getQualityRecheck(id) {
  const job = jobService.readJob(id);
  return job && job.type === "quality-recheck" ? jobService.publicJob(job) : null;
}

module.exports = {
  QUALITY_IGNORES_PATH: repository.QUALITY_IGNORES_PATH,
  listIgnores,
  prepareIgnoreMutation: repository.prepareIgnoreMutation,
  prepareMarkIgnoreMutation,
  prepareUnmarkIgnoreMutation,
  commitPreparedIgnoreMutation: repository.commitPreparedIgnoreMutation,
  commitPreparedQualityMutation,
  markIgnore,
  unmarkIgnore,
  buildQualityReport,
  startQualityRecheck,
  getQualityRecheck,
};
