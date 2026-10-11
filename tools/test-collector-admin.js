"use strict";
const assert=require("node:assert/strict"),{test,before,after}=require("node:test"),fs=require("fs"),path=require("path");
const fixture=require("./test-helpers/collector-admin-harness");let h,session;
before(async()=>{h=await fixture.start();session=await h.login();});after(async()=>{await h.close();});
const api=(url,options={})=>h.request('/api/admin/schedule-collector'+url,options);
const machine=(token,body)=>({method:"POST",headers:{authorization:"Bearer "+token,"x-fosu-client":"service"},body});
test("overview and page require authentication, preserving personal sync navigation",async()=>{
 assert.equal((await api('/overview')).status,401);
 const page=await h.request('/admin/schedule-collector');assert.equal(page.status,302);
 const html=await h.request('/admin/schedule-collector',{cookie:session.cookie});assert.equal(html.status,200);assert.ok(html.text.includes('data-section="campus-sync"'));assert.ok(html.text.includes('data-section="schedule-collector"'));
 const read=await api('/overview',{headers:{authorization:'Bearer fixture-reader'}});assert.equal(read.status,200);assert.equal(read.json.overview.permissions.sample,false);assert.equal(read.json.overview.health.session,'UNKNOWN');assert.deepEqual(read.json.overview.sources.summary,{});
});
test("cookie writes reject missing CSRF and hostile Origin before queue mutation",async()=>{
 h.collector.resetForTests();const body={term:'2026-2027-1',sampleKind:'class',requestBudget:40,idempotencyKey:'sample-csrf-test'};
 assert.equal((await api('/actions/sample',{method:'POST',cookie:session.cookie,body})).status,403);
 assert.equal((await api('/actions/sample',{method:'POST',cookie:session.cookie,body,headers:{origin:'http://public.test','x-fosu-csrf':session.csrfToken}})).status,403);
 assert.equal(h.collector.snapshot().current,null);
 const allowed=await api('/actions/sample',{method:'POST',cookie:session.cookie,body,headers:{origin:h.baseUrl,'x-fosu-csrf':session.csrfToken}});assert.equal(allowed.status,200);h.collector.cancelCurrent();
});
test("sample scope cannot control, review or start formal collections; idempotency survives reload",async()=>{
 h.collector.resetForTests();const body={term:'2026-2027-1',sampleKind:'four',requestBudget:40,idempotencyKey:'sample-rbac-test'};
 const first=await api('/actions/sample',machine('fixture-sample',body));assert.equal(first.status,200);
 h.collector.load();const again=await api('/actions/sample',machine('fixture-sample',body));assert.equal(again.json.queued.run.id,first.json.queued.run.id);
 assert.equal((await api('/actions/pause',machine('fixture-sample',{}))).status,403);
 assert.equal((await api('/runs/'+first.json.queued.run.id+'/review',{headers:{authorization:'Bearer fixture-sample'}})).status,403);
 assert.equal((await api('/actions/full',machine('fixture-sample',{confirmation:'RUN FULL'}))).status,403);
 assert.equal((await api('/actions/full',machine('c1-admin-full',{confirmation:'RUN FULL'}))).json.code,'SCHOOL_SCOPE_REVIEW_REQUIRED');h.collector.cancelCurrent();
});
test("heartbeat metadata is minimal, persisted and never asserts Session validity",()=>{
 h.collector.resetForTests();h.collector.heartbeat('fixture-collector',Date.now(),{observation:{schema:'collector-observation.v1',revision:'a'.repeat(40),executionMode:'heartbeat-only',session:'PRESENT_UNVERIFIED',authBlocked:true}});
 h.collector.load();assert.equal(h.collector.observations().session,'PRESENT_UNVERIFIED');
 assert.throws(()=>h.collector.heartbeat('fixture-collector',Date.now(),{observation:{password:'forbidden-fixture'}}),/STAGING_SENSITIVE/);
 assert.throws(()=>h.collector.heartbeat('fixture-collector',Date.now(),{observation:{schema:'collector-observation.v1',revision:null,executionMode:'queue',session:'SESSION_SAVED',authBlocked:false}}),/OBSERVATION_REJECTED/);
});
test("private normalized review is bounded, scoped and leaves formal data untouched",async()=>{
 const staging=path.join(h.paths.storage,'staging-latest.json'),active=path.join(h.paths.storage,'active-release.json');fs.writeFileSync(staging,'{"fixture":"protected"}');fs.writeFileSync(active,'{"fixture":"active"}');
 const id=await fixture.seedSample(h);const response=await api('/runs/'+id+'/review',{headers:{authorization:'Bearer fixture-review'}});assert.equal(response.status,200,response.text);
 assert.equal(response.json.review.validation.normalizedSample,'PASS');assert.equal(response.json.review.validation.fullCoverage,'UNVERIFIED');assert.equal(response.json.review.validation.publishable,false);assert.equal(response.json.review.schedules.teacher.documents[0].events[0].weeks[0],1);
 assert.ok(!response.text.includes('claimId'));assert.ok(!response.text.includes('completedClaimHash'));assert.ok(!response.text.includes(h.paths.root));
 assert.equal(fs.readFileSync(staging,'utf8'),'{"fixture":"protected"}');assert.equal(fs.readFileSync(active,'utf8'),'{"fixture":"active"}');
 const body={runId:id,canonicalHash:response.json.review.run.canonicalHash,decision:'confirmed',comparisonAttested:false,confirmation:'REVIEW SAMPLE',idempotencyKey:'sample-human-review-test'};
 assert.equal((await api('/actions/review',machine('fixture-review',body))).status,400);
 body.comparisonAttested=true;
 assert.equal((await api('/actions/review',machine('fixture-sample',body))).status,403);
 const payload=path.join(require('../server/src/services/stagingUploadService').UPLOAD_ROOT,response.json.review.run.uploadId,'payload.json'),original=fs.readFileSync(payload),changed=JSON.parse(original);
 changed.classSchedules[0].courses[0].courseName='changed-after-private-receipt';fs.writeFileSync(payload,JSON.stringify(changed));
 const tampered=await api('/actions/review',machine('fixture-review',body));assert.ok(tampered.status>=400&&tampered.status<500);assert.equal(h.collector.adminRun(id).sampleHumanReview,undefined);fs.writeFileSync(payload,original);
 const accepted=await api('/actions/review',machine('fixture-review',body));assert.equal(accepted.status,200);assert.equal(accepted.json.run.publishable,false);
 h.collector.load();assert.equal((await api('/actions/review',machine('fixture-review',body))).json.run.sampleHumanReview.reviewedAt,accepted.json.run.sampleHumanReview.reviewedAt);
 assert.equal((await api('/actions/review',machine('fixture-review',{...body,decision:'rejected'}))).status,409);
 assert.equal(h.collector.snapshot().autoPublish,false);
 assert.equal(fs.readFileSync(staging,'utf8'),'{"fixture":"protected"}');
});
