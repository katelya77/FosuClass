"use strict";
const assert=require("assert"),fs=require("fs"),os=require("os"),path=require("path"),guard=require("../server/src/shared/publicationGuard");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-publication-lock-fixture-"));
try{const release=guard.acquire(root);assert.throws(()=>guard.acquire(root),/PUBLICATION_LOCKED/);release();guard.acquire(root)();assert.throws(()=>guard.assertExpectedVersion("new","old"),/BASELINE_CHANGED/);guard.assertExpectedVersion("new","new");guard.assertExpectedVersion("new",undefined);assert.throws(()=>guard.assertNotOlder({cacheEpoch:1},{cacheEpoch:2}),/REGRESSION/);guard.assertNotOlder({releaseVersion:"explicit-rollback",cacheEpoch:3},{releaseVersion:"new",cacheEpoch:2});
  process.env.FOSU_STORAGE_DIR=path.join(root,"storage");const service=require("../server/src/services/releaseService");
  assert.throws(()=>service.activateReleaseVersion("missing-fixture",{expectedActiveReleaseVersion:"superseded-fixture"}),/BASELINE_CHANGED/);
  assert.equal(fs.existsSync(service.ACTIVE_RELEASE_PATH),false);assert.equal(fs.existsSync(path.join(root,"storage/ops/publication/publication.lock")),false);
  console.log("publication guard: real activation fence, writer exclusion, stale baseline, monotonic pointer and controlled rollback fixtures PASS");}finally{fs.rmSync(root,{recursive:true,force:true});}
