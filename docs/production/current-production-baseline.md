# Current production baseline

This file records what is actually running. It does not contain secrets.

| Item | Value |
|---|---|
| Deployment commit | `39234ac1354eb0715feaf80beddc3b084cd02268` |
| Deployment date | 2026-09-26 02:12 CST |
| Server branch | `fix/campus-sync-admin-fastload` |
| Deploy run | `36171012395` |
| Route 2 status | running |
| WYZ | agent heartbeat available; this server deploy did not reinstall the agent |
| Mini program production version | 3.1.1 experience line. In-repo settings label remains `1.0.0` and is not the upload version |
| Security mode | `session-canary` |

## Current policy

Recorded by the read-only deploy check. Do not treat this as a recommendation.

| Field | Value |
|---|---|
| rateLimit | 3 |
| rateWindowSeconds | 600 |
| dailyLimit | 5 |
| globalActiveCap | 25 |
| updatedAt | 2026-09-25T17:42:22.357Z |
| updatedBy | admin-session |

Control at deploy: not paused.

Recommended operating point, not applied: rateLimit 3, rateWindowSeconds 600, dailyLimit 5, globalActiveCap 10. The worker count stays 1. A cap of 25 can make the tail of the queue longer than the job TTL when jobs are slow.
