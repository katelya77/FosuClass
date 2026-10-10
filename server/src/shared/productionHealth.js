"use strict";
function recent(value,now,limit){return value && now-Date.parse(value)>=0 && now-Date.parse(value)<limit;}
function evaluate(input,now=Date.now()){
  const collector=input.collector||{},network=input.network||{},release=input.release||{},mirror=input.mirror||{};
  return {
    collector:{online:!!collector.collectorOnline,lastHeartbeat:collector.lastHeartbeat||null},
    transport:{confirmed:network.networkStatus==="healthy"&&!!recent(network.lastSuccessfulHeartbeatAt,now,90000),lastHeartbeat:network.lastSuccessfulHeartbeatAt||null,longestGapSeconds:network.longestConfirmedHeartbeatGapSeconds??null,tlsAuthorized:network.tlsAuthorized??"UNKNOWN"},
    collection:{lastSuccessfulAt:collector.lastSuccessAt||null,sessionValidity:input.sessionValidity||"UNKNOWN",fourSourceCompletion:input.fourSourceCompletion||"UNKNOWN"},
    review:{pendingCount:input.pendingReviewCount??"UNKNOWN",approvedCanonicalHash:input.approvedCanonicalHash||null},
    publication:{releaseVersion:release.releaseVersion||null,lastPublishedAt:release.updatedAt||null,distributionConsistent:!!release.releaseVersion&&release.releaseVersion===mirror.releaseVersion&&Number(release.cacheEpoch)===Number(mirror.cacheEpoch)},
    delivery:{lastObservedClientVersion:input.lastObservedClientVersion||null,confirmed:!!input.lastObservedClientVersion&&input.lastObservedClientVersion===release.releaseVersion,p50Ms:input.p50Ms??null,p95Ms:input.p95Ms??null},
    cost:{hostingBytes:input.hostingBytes??null,monthlyTrafficBytes:input.monthlyTrafficBytes??null,monthlyBilledCalls:input.monthlyBilledCalls??null},
  };
}
module.exports={evaluate};
