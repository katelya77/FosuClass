"use strict";
const crypto = require("crypto"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const { startAdminHttpHarness } = require("./admin-http-harness");
async function start() {
  const randomSecret = () => crypto.randomBytes(32).toString("hex");
  const h = await startAdminHttpHarness({ environment:{
    PORT:"3000",
    FOSU_RELEASE_WORKER_ENABLED:"true", SCHEDULE_COLLECTOR_DIR:"fixture-placeholder", FOSU_COLLECTOR_TIMER_VERIFIED:"0",
    FULL_SYNC_AGENT_TOKEN:randomSecret(), FULL_SYNC_SIGNING_SECRET:randomSecret(), FULL_SYNC_AGENT_ID:"fixture-collector",
    ADMIN_SERVICE_TOKENS:JSON.stringify([{name:"reader",token:"fixture-reader",scopes:["static:verify"]},{name:"sample",token:"fixture-sample",scopes:["collector:sample"]},{name:"review",token:"fixture-review",scopes:["collector:review"]}])
  }, onPaths(paths) { process.env.SCHEDULE_COLLECTOR_DIR=path.join(paths.root,"collector"); } });
  require("../../server/src/config").FOSU_ALLOWED_ADMIN_ORIGINS.push(h.baseUrl);
  const collector=require("../../server/src/services/scheduleCollectorService"); collector.resetForTests();
  require("../../server/src/services/termRegistryService").createPlannedTerm({term:"2026-2027-1",termStartDate:"2026-09-07",totalWeeks:20,weekStart:"monday"});
  return Object.assign(h,{collector});
}
async function seedSample(h, kind="four") {
  const collector=h.collector, uploads=require("../../server/src/services/stagingUploadService"), fingerprint=require("../../server/src/utils/stagingFingerprint").calculateFingerprint;
  collector.resetForTests();
  const queued=collector.requestRun("sample","fixture",Date.now(),{term:"2026-2027-1",sampleKind:kind,requestBudget:40,idempotencyKey:"sample-fixture-review"}).run;
  const run=collector.claim("fixture-collector",Date.now(),{mode:"sample",runId:queued.id});
  const data=require("../fixtures/four-direct-source")();data.meta.sampleOnly=true;data.meta.sampleKind=kind;data.meta.actualNetworkRequestCount=12;data.meta.requireFourDirectSources=false;
  for(const stat of Object.values(data.directSourceSummary))stat.requestCount=1;
  if(kind==="class"){data.resources={};data.meta.includeScopes=["classSchedules"];for(const k of ["teacher","classroom","course"]){delete data.directSourceSummary[k];delete data.scopeSources[k+"Schedules"];}}
  data.canonicalHash=fingerprint(data).canonicalHash;
  const raw=Buffer.from(JSON.stringify(data)),gzip=zlib.gzipSync(raw),hash=value=>crypto.createHash("sha256").update(value).digest("hex"),actor={type:"full-sync",id:run.id};
  const upload=uploads.initUpload({term:run.term,canonicalHash:data.canonicalHash,fileName:"sample.json",source:"wyz-schedule-sample",contentEncoding:"gzip",originalSize:raw.length,originalSha256:hash(raw),uploadSize:gzip.length,uploadSha256:hash(gzip),chunkSize:gzip.length,totalChunks:1},actor);
  collector.associateUpload(collector.requireRun(run.id,"fixture-collector",run.claimId),upload.uploadId);
  uploads.writeChunk(upload.uploadId,0,gzip,actor);
  await require("../../server/src/services/stagingFinalizeService").finalizeChunkedUpload({uploadId:upload.uploadId,actor,collectorRun:{runId:run.id,agentId:"fixture-collector",claimId:run.claimId,term:run.term}},null);
  collector.load();collector.applyReport(run.id,{claimId:run.claimId,complete:true,uploadId:upload.uploadId,canonicalHash:data.canonicalHash},"fixture-collector");
  return run.id;
}
module.exports={start,seedSample};
