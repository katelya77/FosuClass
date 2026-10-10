"use strict";
const assert=require("assert");
const policy=require("../server/src/shared/schedulePublicationPolicy");
const kinds=["class","teacher","classroom","course"];
const prior={term:"2026-2027-1",canonicalHash:"a".repeat(64),resourceCounts:Object.fromEntries(kinds.map(k=>[k,{scheduleDocuments:100}]))};
const next={...prior,canonicalHash:"b".repeat(64),coverageValid:true,directSourceSummary:Object.fromEntries(kinds.map(k=>[k,{sourceMode:"network-direct",coverageValid:true,success:100,empty:0,scheduleDocuments:100}]))};
const delta={schema:1,source:"computed-public-schedules-v1",groups:Object.fromEntries(kinds.map(k=>[k,{totalEntities:100,changedEntities:1}]))};
const good=policy.evaluate(prior,next,{changeSummary:delta});assert.equal(good.eligibleForAutoReview,true);assert.equal(good.autoPublish,false);
assert.equal(policy.evaluate(prior,{...next,canonicalHash:prior.canonicalHash}).result,"NO CHANGE");
assert.equal(policy.evaluate(prior,next).reviewClass,"manual");
assert.equal(policy.evaluate(prior,{...next,term:"2026-2027-2"},{changeSummary:delta}).eligibleForAutoReview,false);
assert.equal(policy.evaluate(prior,{...next,canonicalHash:prior.canonicalHash,term:"2026-2027-2"},{changeSummary:delta}).result,"PENDING REVIEW");
assert.equal(policy.evaluate({},next,{changeSummary:delta}).eligibleForAutoReview,false);
for(const kind of kinds){const s=structuredClone(next);s.directSourceSummary[kind].sourceMode="derived";assert.equal(policy.evaluate(prior,s,{changeSummary:delta}).reviewClass,"blocked");const d=structuredClone(delta);d.groups[kind].changedEntities=6;assert.equal(policy.evaluate(prior,next,{changeSummary:d}).reviewClass,"manual");}
const drop=structuredClone(next);drop.resourceCounts.class.scheduleDocuments=89;assert.ok(policy.evaluate(prior,drop).blockers.includes("class-drop"));
const old={classSchedules:[{id:"one",courses:[{name:"a"},{name:"b"}]}]};const order={classSchedules:[{id:"one",courses:[{name:"b"},{name:"a"}]}]};assert.equal(policy.changeSummary(old,order).groups.class.changedEntities,0);
assert.equal(policy.changeSummary(old,{classSchedules:[]}).groups.class.changedEntities,1);
const collision=policy.changeSummary(old,{classSchedules:[{id:"one",courses:[]},{id:"one",courses:[]}]});assert.equal(collision.groups.class.valid,false);assert.equal(policy.evaluate(prior,next,{changeSummary:collision}).eligibleForAutoReview,false);
console.log("shared publication policy fixtures PASS; production autoPublish=false");
