# Personal sync production baseline

This file records the verified Route 2 production state after the real WYZ success. It does not contain secrets, cookies, tickets, student identifiers, or school HTML.

## Versions

| Item | Value |
|---|---|
| Branch | `fix/personal-sync-input-stability-v4` |
| Oracle commit | `6b89a688fcc11b06a5a2041b34b2bbbf2ba5caaf` |
| WYZ bundle | `wyz-campus-agent-6b89a688fcc11b06a5a2041b34b2bbbf2ba5caaf.tar.gz` |
| WYZ bundle sha256 | `921ad284c20e43c54c346876cb1a69cfdead57e6c08b5808480ce5e67c1fca99` |
| WYZ bundle size | 229114 bytes |
| Deploy run that published this Oracle commit | `36258490085` |
| Real acceptance | Operator confirmed `job-claimed`, `profile-fetched status=ok`, `job-finished code=OK status=200` on the installed WYZ node |

The school-login code in Oracle and the installed WYZ bundle is the same commit, `6b89a688`. Later Oracle-only admin deploys do not change that agent. Heartbeat does not carry a WYZ commit, so the admin page shows the Oracle short sha separately and shows WYZ version as not reported. An older agent that omits `authMode` can still finish a job. The installed agent sends the optional enum `mobile`, `cas`, or `authenticated-session`.

## Route 2

Mini program -> Oracle Campus Sync Broker -> WYZ Agent -> school mobile login -> `xskb` -> `/grxx/xsxx` -> Oracle preview -> mini program.

The WYZ Node transport sets one fixed mobile User-Agent from `SCHOOL_MOBILE_USER_AGENT`. Callers, job payloads, and request headers cannot replace it. `wx.request` is not asked to override the WeChat client User-Agent. Referer, Origin, and Authorization are not added. A school captcha, slider, or risk check still ends as `INTERACTIVE_CHALLENGE_REQUIRED`.

## Operating limits

Last read-only check during deploy `36258490085`, before and after publish:

| Field | Value |
|---|---|
| rateLimit | 3 |
| rateWindowSeconds | 600 |
| dailyLimit | 5 |
| globalActiveCap | 10 |
| updatedAt | 2026-09-26T12:51:23.142Z |
| updatedBy | admin-session |
| Worker | 1 |
| Single-user concurrency | 1 |
| Job TTL default | 90 seconds, unless `CAMPUS_SYNC_JOB_TTL_SECONDS` is set in the server environment |
| Agent heartbeat interval | 30 seconds |
| Agent offline TTL | 90 seconds |
| Challenge cooldown | 600 seconds, keyed by a principal hash, not shown in full |

Code defaults are different from this stored policy. The stored policy file is the production source. This closure does not change it.

## Compatibility

| Side | Expectation |
|---|---|
| Oracle `6b89a688` | Accepts a result with or without `authMode` |
| WYZ bundle above | Sends the mobile User-Agent and may send `authMode` |
| Mini program | Unchanged by the observability closure |
