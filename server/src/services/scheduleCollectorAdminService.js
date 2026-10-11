"use strict";
const fs = require("fs"), path = require("path");
const collector = require("./scheduleCollectorService");
const uploads = require("./stagingUploadService");
const tokens = require("./serviceTokenService");
const contract = require("../shared/sampleCollectionContract");
const KINDS = ["class", "teacher", "classroom", "course"];
const safeText = value => typeof value === "string" ? value.slice(0, 160) : null;
function permissions(identity) {
  const has = scope => tokens.hasAnyScope(identity, [scope, tokens.SCOPES.ADMIN_FULL]);
  return { sample:has(tokens.SCOPES.COLLECTOR_SAMPLE), control:has(tokens.SCOPES.COLLECTOR_CONTROL), review:has(tokens.SCOPES.COLLECTOR_REVIEW), full:has(tokens.SCOPES.COLLECTOR_FULL) && process.env.FOSU_COLLECTOR_SCOPE_APPROVED === "1" };
}
function overview(identity) {
  const status = collector.snapshot(), observation = collector.observations();
  const readiness = collector.sampleReadiness();
  const active = require("./releaseService").getActiveReleaseInfo() || {};
  const current = status.current;
  const sourceRun = current?.directSourceSummary ? current : collector.history().find(run => run.directSourceSummary);
  const revision = process.env.FOSU_DEPLOY_COMMIT_SHA;
  return { generatedAt:new Date().toISOString(), status, permissions:permissions(identity), readiness,
    health:{ collector:status.collectorOnline ? "HEARTBEAT_RECENT" : status.lastHeartbeat ? "HEARTBEAT_STALE" : "UNKNOWN", observationFresh:status.collectorOnline && observation?.observedAt === status.lastHeartbeat,
      observation, oracleRevision:/^[a-f0-9]{40}$/.test(revision || "") ? revision : null,
      oracleApi:"RESPONDED", signatureConfigured:Boolean(require("../security/fullSyncSignature").secretsConfigured()),
      session:status.sessionExpired ? "SESSION_EXPIRED" : observation?.session || "UNKNOWN", phase:current?.stage || "idle", lastCollectionSuccessAt:status.lastSuccessAt },
    sources:{ runId:sourceRun?.id || null, sampleOnly:sourceRun?.mode === "sample", summary:sourceRun?.directSourceSummary || {} },
    active:{ version:safeText(active.version), term:safeText(active.term || active.semester), canonicalHash:/^[a-f0-9]{64}$/.test(active.canonicalHash || "") ? active.canonicalHash : null, resourceCounts:active.resourceCounts || null },
    runs:collector.history(), fullCollectionApproved:process.env.FOSU_COLLECTOR_SCOPE_APPROVED === "1", autoPublish:false };
}
function review(runId) {
  const run = collector.adminRun(runId);
  if (run.mode !== "sample") return { run:collector.publicRun(run), reviewKind:"formal-staging", publicationDecision:{ result:run.result || "UNVERIFIED", qualityBlocked:run.qualityBlocked !== false, reasons:run.reasons || [] } };
  const receipt = require("./sampleReviewService").readReview(run);
  if (!/^stg_[A-Za-z0-9_-]+$/.test(run.uploadId || "")) throw Object.assign(new Error("SAMPLE_REVIEW_REJECTED"), { code:"SAMPLE_REVIEW_REJECTED" });
  const directory = path.join(uploads.UPLOAD_ROOT, run.uploadId), file = path.join(directory, "payload.json");
  for (const item of [uploads.UPLOAD_ROOT, directory, file]) if (fs.lstatSync(item).isSymbolicLink()) throw Object.assign(new Error("SAMPLE_REVIEW_REJECTED"), { code:"SAMPLE_REVIEW_REJECTED" });
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > contract.MAX_ORIGINAL_BYTES) throw Object.assign(new Error("SAMPLE_REVIEW_REJECTED"), { code:"SAMPLE_REVIEW_REJECTED" });
  const data = uploads.normalizeStagingData(JSON.parse(fs.readFileSync(file, "utf8")));
  const validated = contract.assertSample(data, run.term, run.samplePolicy, run.termConfig);
  if (validated.canonicalHash !== receipt.canonicalHash) throw Object.assign(new Error("SAMPLE_REVIEW_CONFLICT"), {code:"SAMPLE_REVIEW_CONFLICT",statusCode:409});
  const schedules = {};
  for (const kind of KINDS) {
    const items = kind === "class" ? data.classSchedules || [] : data.resources?.[kind + "Schedules"] || [];
    schedules[kind] = { total:items.length, truncated:items.length > 25, documents:items.slice(0, 25).map(item => ({
      name:safeText(item[{class:"className",teacher:"teacherName",classroom:"roomName",course:"courseName"}[kind]]),
      semester:safeText(item.semester || item.term), classIdentity:kind === "class" ? { classId:safeText(item.classId), collegeCode:safeText(item.collegeCode), grade:safeText(item.grade), majorCode:safeText(item.majorCode) } : null,
      eventCount:item.courses.length, truncated:item.courses.length > 40,
      events:item.courses.slice(0, 40).map(event => ({ courseName:safeText(event.courseName), teacherName:safeText(event.teacherName), roomName:safeText(event.roomName || event.classroom), weekday:event.weekday, startSection:event.startSection, endSection:event.endSection, weeks:event.weeks }))
    })) };
  }
  return { run:collector.publicRun(run), receipt, termConfig:{ term:run.term, totalWeeks:run.termConfig.totalWeeks, termStartDate:run.termConfig.termStartDate, weekStart:run.termConfig.weekStart },
    validation:{ normalizedSample:"PASS", duplicateEvents:0, invalidWeeks:0, invalidSections:0, crossSourceConsistency:"NOT_EVALUATED_BOUNDED_TARGETS", schoolManualComparison:run.sampleHumanReview?.decision === "confirmed" ? "ADMIN_ATTESTED" : run.sampleHumanReview?.decision === "rejected" ? "REJECTED" : "REQUIRED", fullCoverage:"UNVERIFIED", publishable:false }, schedules };
}
module.exports = { overview, permissions, review };
