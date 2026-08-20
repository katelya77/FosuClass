# Environment Capability Report

Discovery time: 2026-08-20 (Asia/Shanghai). This report contains capability state only; no credential value or account identifier is recorded.

| Capability | Installed | Version | Authenticated | Safe read-only interfaces |
|---|---:|---|---:|---|
| CloudBase CLI (`tcb`) | YES | 3.5.6 | YES | environment list/detail; function list/detail/log/code download; generic Tencent Cloud API |
| Node.js | YES | v24.15.0 | N/A | local control scripts |
| npm | YES | 11.12.1 | N/A | repository commands |
| GitHub CLI | YES | 2.78.0 | YES | PR/head/check status |
| Tencent Cloud CLI (`tccli`) | NO | — | NO | none |
| Tencent Cloud Node SDK | NO | — | NO | none |

Tencent ADP API discovery:

- Official ADP actions are reachable in principle through authenticated `tcb api adp <Action> --api-version 2026-05-20`.
- Actual `DescribeApp` / `DescribeAgentDetail` / `DescribePlugin` reads are **BLOCKED/UNKNOWN** because App/Plugin/Agent non-secret IDs are not configured in the ignored local config or environment.
- Safe ADP writes remain **DRY-RUN ONLY** until those IDs and the exact writable response shape have been observed. `CreateRelease`, publication and deletion are permanently denied by this control plane.
- CloudBase `campusflowAdpTools` detail and code download are read-reachable. Environment-variable values are neither queried into reports nor printed.
