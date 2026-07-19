# Admin Migration Risk Register (Phase A)

> Historical snapshot. The Vue migration is superseded; the Legacy-only admin is retained.

Generated for Phase A inventory. Update when phases complete or new hazards appear.

## Risk scale

| Level | Meaning |
|-------|---------|
| P0 | Production data plane / miniprogram schedule integrity |
| P1 | Admin write corruption, security incident, irreversible publish |
| P2 | Feature gap / degraded ops UX |
| P3 | Cosmetic or docs only |

## Active risks

| ID | Area | Level | Description | Mitigation | Residual |
|----|------|-------|-------------|------------|----------|
| R-01 | Dual write processes | P0 | Two backend instances writing same JSON/storage | Keep single authoritative Node process; forbid dual-writer deploy | Low if deploy contract held |
| R-02 | Business logic duplication | P0 | Vue handler copies Legacy logic | Extract Domain Service first; CI `test-admin-no-duplicate-business-logic` (Phase B+) | Medium until extractions land |
| R-03 | Active Pointer auto-switch | P0 | Automated tests flip production Active | Production smoke: dry-run/preflight only; never auto-activate | Low with policy enforcement |
| R-04 | Release publish from CI | P0 | CI publishes unauthorized release | Block production write modules via flags; no publish in smoke | Low |
| R-05 | Staging finalize corruption | P0 | Bad finalize corrupts staging | Existing finalize safety + job isolation | Medium |
| R-06 | Term activation non-atomic | P0 | Multi-API client-side “transaction” | Keep `semesterActivationTransactionService` only path | Low if Vue reuses service |
| R-07 | CSRF gaps on writes | P1 | Session write without CSRF | All Vue writes use cookie + CSRF; CI CSRF tests | Medium (Legacy mixed verify paths) |
| R-08 | Scope default-deny bypass | P1 | Undeclared mutation with weak token | `adminRouteScopes` default `admin:full` | Medium |
| R-09 | Secret leakage | P1 | Provider keys returned to browser | Mask keys server-side; never log secrets | Medium on provider migration |
| R-10 | Concurrent config overwrite | P1 | Silent last-write-wins on notices/config/map | Add version/ETag/If-Match → 409 | High until concurrency control |
| R-11 | Missing idempotency | P1 | Double-click rebuild/publish/sync | Idempotency-Key for critical jobs | High until Phase D |
| R-12 | Long HTTP jobs | P1 | Browser disconnect mid-publish | Job system + poll/SSE only | Medium |
| R-13 | Tier3 failure blocks Tier0 | P1 | Assistant/provider crash admin boot | Fail-open isolation tests | Low |
| R-14 | ARM64 native binary | P1 | amd64-only Chromium/native deps in image | Multi-arch Docker build verification | Medium |
| R-15 | admin.js growth | P2 | Monolith keeps growing | Architecture hard ceilings | Low |
| R-16 | Incomplete feature matrix | P2 | Untracked write button | Matrix coverage CI vs admin.js + Legacy UI paths | Low after Phase A |
| R-17 | ExperimentalPage cutover | P2 | Cutover with placeholders | Guard: cutover-ready forbids ExperimentalPage | Low |
| R-18 | Legacy fallback dependency | P2 | Ops still needs Legacy for critical task | Matrix nextStatus + fallback metrics before Phase F | High until parity |
| R-19 | Docker without SPA assets | P2 | Image missing admin-app | Existing deploy fix + CI bundle parity | Low |
| R-20 | Early Legacy deletion | P1 | Remove Legacy before stability evidence | Phase F gates; `LEGACY_REMOVAL_STATUS` | Low if process followed |
| R-21 | DB migration distraction | P2 | Forced PG/SQLite before UI parity | ADR only; keep JSON repositories | Low |
| R-22 | Feedback PII | P1 | Export/list exposes sensitive fields | Redaction in service before Vue | Medium |
| R-23 | Backup restore on prod smoke | P0 | Automated restore mutates prod | Smoke never restores; isolated env only | Low |
| R-24 | Campus map asset overwrite | P1 | Publish wrong map version | Confirm dialogs + version history + rollback | Medium |
| R-25 | Knowledge base wipe | P1 | Clear/import destroys KB | Strong confirm + backup + publish/rollback | Medium |

## Phase risk focus

| Phase | Elevated risks | Production primary |
|-------|----------------|--------------------|
| A | R-16 inventory completeness | legacy (unchanged) |
| B | R-07, R-10, R-22 content/feedback writes | legacy |
| C | R-09, R-13, R-24, R-25 system modules | legacy |
| D | R-03–R-06, R-11, R-12 control plane | legacy |
| E | R-17, R-18 cutover | next |
| F | R-20 Legacy removal | next |

## Production safety constraints (must not automate)

- Switch real Active Pointer
- Publish unauthorized schedule release
- Activate new term
- Restore production backup
- Delete production data / clear knowledge base
- Rotate all provider keys
- Print secrets
- Overwrite production `.env` with `.env.example`

## Observability needed before Phase F

- Legacy page hits
- Legacy fallback count
- Vue 5xx / 401 / 403 spikes
- Write failures
- Job failures
- Uncaught frontend errors

Without ≥7 days clean evidence:

```text
LEGACY_REMOVAL_STATUS=BLOCKED_STABILITY_EVIDENCE
```

## Status

```text
PHASE_A_RISK_REGISTER=READY
PRODUCTION_PRIMARY_ADMIN=legacy
ACTIVE_POINTER_CHANGED=false  # Phase A makes no control-plane writes
```
