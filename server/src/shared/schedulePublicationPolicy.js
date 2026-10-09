"use strict";
const crypto = require("crypto");
const { stableStringify } = require("../utils/stagingFingerprint");
const KINDS = ["class","teacher","classroom","course"];
function schedules(data,kind) { return data && (data[kind+"Schedules"] || data.resources && data.resources[kind+"Schedules"]) || []; }
function changeSummary(previous,next) {
  const groups = {};
  for (const kind of KINDS) {
    const index = data => {
      const list=schedules(data,kind),map=new Map();let valid=Array.isArray(list);
      for(const s of valid?list:[]){const id=String(s.id || s.classId || s.teacherId || s.roomId || s.classroomId || s.courseId || s.className || s.teacherName || s.roomName || s.classroomName || s.courseName || "");
        if(!id || map.has(id) || !Array.isArray(s.courses))valid=false;
        map.set(id,crypto.createHash("sha256").update(stableStringify((s.courses || []).map(c=>stableStringify(c)).sort())).digest("hex"));
      }
      return {map,valid};
    };
    const before=index(previous),after=index(next),ids=new Set([...before.map.keys(),...after.map.keys()]);
    groups[kind]={valid:before.valid&&after.valid,totalEntities:ids.size,changedEntities:[...ids].filter(id=>before.map.get(id)!==after.map.get(id)).length};
  }
  return { schema:1,source:"computed-public-schedules-v1",groups };
}
function evaluate(previous,incoming,options={}) {
  const prior=previous||{},next=incoming||{},blockers=[],manual=[];
  if (next.coverageValid !== true) blockers.push("coverage-invalid");
  for(const kind of KINDS) {
    const stat=next.directSourceSummary && next.directSourceSummary[kind];
    if(!stat || stat.sourceMode!=="network-direct" || stat.coverageValid!==true || stat.failed || stat.parserErrors) blockers.push(kind+"-source-invalid");
    if(stat && stat.empty/Math.max(1,stat.success+stat.empty)>0.5) blockers.push(kind+"-empty-rate");
    const before=Number(prior.resourceCounts?.[kind]?.scheduleDocuments || prior.counts?.[kind]);
    const after=Number(next.resourceCounts?.[kind]?.scheduleDocuments || stat?.scheduleDocuments || next.counts?.[kind]);
    if(!after) blockers.push(kind+"-empty");
    if(before>0 && after<before*0.9) blockers.push(kind+"-drop");
  }
  if(!blockers.length && prior.canonicalHash && next.canonicalHash===prior.canonicalHash && (!prior.term || !next.term || prior.term===next.term)) return {result:"NO CHANGE",autoPublish:false,eligibleForAutoReview:false,reviewClass:"unchanged",reasons:[],blockers:[]};
  if(!prior.term || !prior.canonicalHash) manual.push("initial-release-review");
  else if(next.term!==prior.term) manual.push("semester-change");
  const delta=options.changeSummary;
  if(!delta || delta.schema!==1 || delta.source!=="computed-public-schedules-v1") manual.push("change-metrics-unavailable");
  else for(const kind of KINDS) {
    const item=delta.groups && delta.groups[kind];
    if(!item || item.valid===false || !Number.isInteger(item.totalEntities) || item.totalEntities<=0 || !Number.isInteger(item.changedEntities) || item.changedEntities<0 || item.changedEntities>item.totalEntities) manual.push(kind+"-change-metrics-invalid");
    else if(item.changedEntities/item.totalEntities>0.05) manual.push(kind+"-large-change");
  }
  const eligible=!blockers.length&&!manual.length;
  return {schema:1,result:"PENDING REVIEW",autoPublish:false,eligibleForAutoReview:eligible,reviewClass:blockers.length?"blocked":eligible?"auto-eligible":"manual",reasons:[...new Set([...blockers,...manual,...(eligible?["auto-publish-disabled"]:[])])],blockers:[...new Set(blockers)]};
}
module.exports={changeSummary,evaluate};
