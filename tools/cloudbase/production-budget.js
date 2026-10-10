#!/usr/bin/env node
"use strict";
const fs=require("fs");
function model(measurement,options={}){
  const cloud=measurement.find(r=>r.source==="cloudbase");
  if(!cloud || cloud.errors.length)throw Error("COMPLETE_CLOUDBASE_MEASUREMENT_REQUIRED");
  const records=cloud.records,find=suffix=>records.find(r=>r.path.endsWith(suffix)).httpBodyBytes;
  const pointer=find("/active.json"),manifest=find("/manifest.json"),classIndex=find("/index/class/all.json");
  const classDetail=records.find(r=>r.path.includes("/detail/class/")).httpBodyBytes;
  const details=records.filter(r=>r.path.includes("/detail/")),indexes=records.filter(r=>r.path.includes("/index/"));
  const userOperations = {
    pointerCheck: { requests: 1, httpBodyBytes: pointer },
    classColdRead: { requests: 4, httpBodyBytes: pointer+manifest+classIndex+classDetail },
    teacherColdRead: { requests: 4, httpBodyBytes: pointer+manifest+find("/index/teacher/all.json")+records.find(r=>r.path.includes("/detail/teacher/")).httpBodyBytes },
    cachedScheduleView: { scheduleDownloadBytes: 0, pointerCheckBytesWhenDue: pointer },
    measuredFourTypeReads: { requests: records.length, httpBodyBytes: cloud.totalHttpBodyBytes },
    boundary: "schedule resources only; excludes bootstrap, announcements, TLS/header overhead and other API traffic; cached view assumes a valid unchanged release"
  };
  const profiles=[
    {name:"weekly-class-cache",description:"6 pointer reads/day; one new class manifest/index/detail per week",requestsPerUserDay:6+3/7,bytesPerUserDay:6*pointer+(manifest+classIndex+classDetail)/7},
    {name:"daily-class-update",description:"6 pointer reads/day; a changed release requires one class manifest/index/detail daily",requestsPerUserDay:9,bytesPerUserDay:6*pointer+manifest+classIndex+classDetail},
    {name:"cold-four-source-daily",description:"Every day downloads pointer, manifest, all four indexes, four details",requestsPerUserDay:10,bytesPerUserDay:cloud.totalHttpBodyBytes},
    {name:"heavy-search-cache",description:"10 pointers + 10 uncached details/day; manifest + four indexes weekly",requestsPerUserDay:20+5/7,bytesPerUserDay:10*pointer+10*details.reduce((a,r)=>a+r.httpBodyBytes,0)/details.length+(manifest+indexes.reduce((a,r)=>a+r.httpBodyBytes,0))/7}
  ];
  return {measuredRelease:cloud.releaseVersion,userOperations,quotaBasis:"user console fixed-quota evidence and official fixed-quota document; actual monthly usage/billing mode/overage switch still UNKNOWN; resource-point plans must not be substituted",quota:{storageTrafficGB:10,originTrafficGB:10,calls:200000,hostingGB:1},assumptions:{days:30,GB:1e9,originMissRates:[0,0.1,1],dynamicCloudCallsPerUserDay:options.dynamicCalls||0,otherResourceUsage:"not included",wireBytes:"encoded HTTP body only"},profiles,scenarios:profiles.flatMap(profile=>[500,1000,2000,5000,10000].map(dau=>{
    const httpRequests=dau*30*profile.requestsPerUserDay,trafficGB=dau*30*profile.bytesPerUserDay/1e9;
    return {profile:profile.name,dau,requestsPerUserDay:profile.requestsPerUserDay,bytesPerUserDay:profile.bytesPerUserDay,monthlyHostingHttpRequests:Math.ceil(httpRequests),monthlyStorageTrafficGB:trafficGB,
      originSensitivity:[0,0.1,1].map(missRate=>({missRate,monthlyBilledCalls:Math.ceil(httpRequests*missRate+dau*30*(options.dynamicCalls||0)),monthlyOriginTrafficGB:trafficGB*missRate,estimatedTrafficOverageYuan:Math.max(0,trafficGB-10)*0.21+Math.max(0,trafficGB*missRate-10)*0.15})),
      exceedsStorageTrafficQuota:trafficGB>10,capacityGrowthDependsOnReleaseCount:true};
  }))};
}
if(require.main===module){const input=process.argv[2]||".local/cloudbase-transfer-measurement.json";console.log(JSON.stringify(model(JSON.parse(fs.readFileSync(input,"utf8"))),null,2));}
module.exports={model};
