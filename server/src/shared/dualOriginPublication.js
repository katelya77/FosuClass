"use strict";
const {assertExpectedVersion}=require("./publicationGuard");
// The control-plane adapter must supply protected, audited operations. This
// contract never authenticates or enables automatic publication by itself.
async function publish(plan,operations){
  if(!plan || plan.approved!==true || plan.confirmation!=="CONFIRM_DUAL_ORIGIN_PUBLICATION" || !plan.releaseVersion || !/^[a-f0-9]{64}$/.test(plan.canonicalHash||""))throw Object.assign(new Error("PUBLICATION_APPROVAL_REQUIRED"),{code:"PUBLICATION_APPROVAL_REQUIRED"});
  for(const key of ["verifyImmutableRelease","prepareOracle","mirrorCloudbase","verifyOracle","verifyCloudbase","readOraclePointer","activateOracle","activateCloudbase","audit"])if(typeof operations[key]!=="function")throw Object.assign(new Error("PUBLICATION_ADAPTER_REQUIRED"),{code:"PUBLICATION_ADAPTER_REQUIRED"});
  const receipt={schema:1,releaseVersion:plan.releaseVersion,canonicalHash:plan.canonicalHash,events:[],status:"preparing",oracleActivated:false,cloudbaseActivated:false};
  async function step(name,fn){await operations.audit({...receipt,event:name,state:"started"});const result=await fn();receipt.events.push(name);await operations.audit({...receipt,event:name,state:"completed"});return result;}
  try{
    await step("verify-immutable-release",()=>operations.verifyImmutableRelease(plan));
    await step("prepare-oracle",()=>operations.prepareOracle(plan));
    await step("mirror-cloudbase",()=>operations.mirrorCloudbase(plan));
    await step("verify-oracle",()=>operations.verifyOracle(plan));
    await step("verify-cloudbase",()=>operations.verifyCloudbase(plan));
    const current=await operations.readOraclePointer();
    // A resumed transaction can reconcile the mirror after Oracle committed.
    if(current.releaseVersion!==plan.releaseVersion){
      assertExpectedVersion(current.releaseVersion,plan.expectedActiveReleaseVersion);
      await step("activate-oracle",()=>operations.activateOracle(plan));
    }
    receipt.oracleActivated=true;
    // The CloudBase adapter must enforce the same epoch and compare its current
    // pointer before commit/rollback. Resources are already available on both.
    const authoritative=await operations.readOraclePointer();
    assertExpectedVersion(authoritative.releaseVersion,plan.releaseVersion);
    await step("activate-cloudbase",()=>operations.activateCloudbase({...plan,pointer:authoritative}));
    receipt.cloudbaseActivated=true;receipt.status="published";
    await operations.audit({...receipt,event:"publication-finished",state:"completed"});return receipt;
  }catch(error){receipt.status=receipt.oracleActivated?"reconciliation-required":"failed-before-activation";await operations.audit({...receipt,event:"publication-finished",state:"failed",code:error.code||"PUBLICATION_FAILED"});error.receipt=receipt;throw error;}
}
module.exports={publish};
