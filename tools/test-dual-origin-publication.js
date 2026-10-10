"use strict";
const assert=require("assert"),contract=require("../server/src/shared/dualOriginPublication");
const plan={approved:true,confirmation:"CONFIRM_DUAL_ORIGIN_PUBLICATION",releaseVersion:"v2",canonicalHash:"a".repeat(64),expectedActiveReleaseVersion:"v1"};
function fixture(){let current={releaseVersion:"v1",cacheEpoch:1};const calls=[];const ops={audit:async()=>{}};for(const name of ["verifyImmutableRelease","prepareOracle","mirrorCloudbase","verifyOracle","verifyCloudbase"])ops[name]=async()=>{calls.push(name);};ops.readOraclePointer=async()=>current;ops.activateOracle=async()=>{calls.push("activateOracle");current={releaseVersion:"v2",cacheEpoch:2};};ops.activateCloudbase=async p=>{calls.push("activateCloudbase");assert.equal(p.pointer.cacheEpoch,2);};return {ops,calls,set:p=>{current=p;}};}
async function main(){
  const ok=fixture();assert.equal((await contract.publish(plan,ok.ops)).status,"published");assert.deepEqual(ok.calls,["verifyImmutableRelease","prepareOracle","mirrorCloudbase","verifyOracle","verifyCloudbase","activateOracle","activateCloudbase"]);
  const failed=fixture();failed.ops.verifyCloudbase=async()=>{throw Error("fixture unavailable");};await assert.rejects(contract.publish(plan,failed.ops),e=>e.receipt.status==="failed-before-activation");assert.ok(!failed.calls.includes("activateOracle"));
  const stale=fixture();stale.set({releaseVersion:"v3",cacheEpoch:3});await assert.rejects(contract.publish(plan,stale.ops),/BASELINE_CHANGED/);assert.ok(!stale.calls.includes("activateOracle"));
  const lag=fixture();lag.ops.activateCloudbase=async()=>{throw Error("fixture mirror pointer failed");};await assert.rejects(contract.publish(plan,lag.ops),e=>e.receipt.status==="reconciliation-required"&&e.receipt.oracleActivated);
  const retry=fixture();retry.set({releaseVersion:"v2",cacheEpoch:2});await contract.publish(plan,retry.ops);assert.ok(!retry.calls.includes("activateOracle"));
  await assert.rejects(contract.publish({...plan,approved:false},fixture().ops),/APPROVAL_REQUIRED/);
  console.log("dual-origin contract: ordered prepare/verify/commit, interrupted mirror reconciliation, stale writer rejection, idempotent resume fixtures PASS; production adapter not enabled");
}main().catch(e=>{console.error(e);process.exitCode=1;});
