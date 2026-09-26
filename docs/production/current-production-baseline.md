# Current production baseline

This file records what is actually running. It does not contain secrets.

| Item | Value |
|---|---|
| Deployment commit | `b4493c586f8bf76fb94d0a7d2534fd257ca66b50` |
| Deployment date | 2026-09-26 20:21 CST |
| Server branch | `fix/campus-sync-admin-fastload` |
| Deploy run | `36241122347` |
| Route 2 status | running |
| WYZ | bundle for this commit is on the server under `route2-artifacts/`; the running agent was not reinstalled by this deploy |
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
