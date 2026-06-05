# Redis / BullMQ Job Queue Evaluation

## Decision

Do not introduce Redis or BullMQ for the current single-instance FosuClass release pipeline.

The immediate 504 risk is CPU-bound Release Pack work running in the same Node.js event loop as the Web API. Moving release-heavy jobs to a child process fixes that failure mode without changing the Release Pack storage model or adding an external service.

## Current Approach

- Job state remains file-backed under `server/storage/jobs`.
- Release-heavy tasks share the `release-heavy` lock group.
- The API process creates a queued job and forks `server/src/workers/releaseWorker.js`.
- The worker writes progress, logs, result, and errors back to the persisted job file.
- Static Release Pack JSON remains file-based and CDN/OpenResty-served.

## Where Redis Fits Later

Redis is a good fit for:

- cross-process or multi-host job queues;
- distributed locks;
- progress fan-out;
- rate limiting;
- retry metadata and delayed jobs.

BullMQ becomes useful when there are multiple workers, multiple VPS instances, or a need for durable retry/backoff scheduling beyond the current file-backed queue.

## Where Redis Does Not Fit

Redis should not store the full school Release Pack. The Release Pack is large, static, CDN-friendly JSON, and the existing directory layout already serves the miniprogram efficiently.

Redis also does not solve synchronous gzip/Brotli CPU usage by itself. Compression must be moved out of the API process and run with controlled concurrency whether the job queue is file-backed, Redis-backed, or BullMQ-backed.

## Future Adapter Boundary

If the service grows beyond one worker, add a `JobStore` / `JobQueue` adapter with the current file implementation as the default and a Redis/BullMQ implementation as an optional production adapter.
