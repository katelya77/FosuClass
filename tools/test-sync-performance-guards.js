const assert = require("assert");
const fs = require("fs");
const path = require("path");

const syncSource = fs.readFileSync(path.join(__dirname, "fosu-sync-client", "sync.js"), "utf-8");
const uploadSource = fs.readFileSync(path.join(__dirname, "fosu-sync-client", "upload.js"), "utf-8");

assert(syncSource.includes("function getClassCrawlConcurrency()"), "sync client should parse class crawl concurrency");
assert(syncSource.includes("SYNC_CLASS_MAX_CONCURRENCY"), "sync client should consume SYNC_CLASS_MAX_CONCURRENCY");
assert(syncSource.includes("crawlMajorClassSchedule"), "class crawl should be factored into a batchable worker");
assert(syncSource.includes("batchStart += classCrawlConcurrency"), "class crawl should process majors in bounded batches");
assert(syncSource.includes("本地进度在每个批次结束后落盘"), "class crawl should document resumable batch progress");
assert(syncSource.includes('process.env.SYNC_UPLOAD_CHUNK_SIZE || "50"'), "legacy class upload default chunk size should be 50");
assert(!syncSource.includes('process.env.SYNC_UPLOAD_CHUNK_SIZE || "10"'), "legacy class upload should not fall back to 10 item batches");

assert(uploadSource.includes("function getUploadConcurrency(params, totalChunks)"), "local staging upload should parse chunk concurrency");
assert(uploadSource.includes("SYNC_LOCAL_UPLOAD_CONCURRENCY"), "local staging upload should support env concurrency override");
assert(uploadSource.includes("uploadWorker"), "local staging upload should use worker-based bounded concurrency");
assert(uploadSource.includes("all chunks uploaded in"), "local staging upload should emit an upload timing summary");

console.log("test-sync-performance-guards passed");
