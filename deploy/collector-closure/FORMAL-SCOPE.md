# Formal collection approval and execution contract

Status: **LOCKED_PENDING_REAL_FOUR_SOURCE_ACCEPTANCE_AND_INDEPENDENT_SCOPE**. This is the implementation and approval contract for the next stage, not evidence that a full run is available or complete. Preserve existing syncPlan, Collector, Broker, parser, private staging and release APIs.

Before proposing a run, require the actual class and four-source Oracle review receipts, term, canonical hashes, per-source failures, sample comparison decisions and current source catalog counts. No generated course facts or derived substitute sources qualify. A Sample with independent targets cannot prove cross-source course matching; identify a real intersecting course/class/teacher/room for this validation.

## One bounded scope approval

The scope must bind school authorization, real term, run ID, source kinds, explicit target IDs or catalog hash and counts, window expiry, request budget, permitted one-GET retry, private evidence retention and a publication decision of `NOT_APPROVED`. Approve routine incremental targets first. Keep full-directory coverage as a separate approval. School credentials and Sessions remain only on WYZ.

For catalog counts C/T/R/K, let N=C+T+R+K be approved timetable targets. Measure discovery requests D and Session probes P in the real adapter; do not estimate them as zero. The upper bound is `D + P + N + approvedRetryCount`, with `approvedRetryCount <= N` and the hard stop at the approved total. Password submission is a separate zero-by-default budget. Concurrency is 1; spacing is 900–1300 ms; idempotent GET gets at most one retry. Authentication, CAPTCHA, policy review, Session expiry and unexpected structure stop without credential replay. Rate limits honor the school's wait interval and the approval deadline; repeated failure pauses for review.

## Required incremental and resumable implementation

After real four-source acceptance, add the missing routine/full functionality in an independent branch. Existing CLI currently refuses it and must stay locked until these controls pass:

- Freeze the approved catalog hash and target set; checkpoints bind run/term/source/target/parser revision, target status, request counters and raw-to-normalized digest. Persist atomically before and after each request. A crash with an ambiguous request outcome consumes its budget rather than resetting it.
- Reuse last-reviewed per-target canonical hashes for an approved incremental scope. Skip identical canonical output for upload; periodically request selected targets under an explicit freshness policy. An unchanged schedule hash does not prove that an unrequested target is current.
- Resume the same approved run and remaining budget only after verifying catalog, scope expiry, source revision and checkpoints. Session refresh remains independently approved. No automatic routine restart, timer or infinite loop.
- Use existing signed transport and staging idempotency keys derived from run/term/source/target/content hash. Verify Oracle ownership and receipt hashes before marking upload complete. Preserve failed targets for retry within the same budget; never count them as complete.
- Report discovered/approved/requested/succeeded/empty/failed/parsed/uploaded/reviewed counts separately for each source. Distinguish valid empty pages from authentication or malformed pages. Coverage denominator is the approved, fixed, complete catalog; partial scopes report scoped completion, never school-wide coverage.
- Check source relationships and period/week parity against retained original responses in private storage. A >10% count drop, unknown class abbreviation, unresolved parse error or inconsistent relationship requires review.

The eventual one-shot entry must consume this scope through the protected admin task API and installed Collector CLI, run under a detached bounded systemd job, and save a private terminal receipt. Until that implementation is accepted, `manual-sync --mode=routine` and `--mode=full` must continue returning `SCHOOL_SCOPE_REVIEW_REQUIRED`.

## Independent publication

Collected results enter private review first. A named administrator confirms evidence and coverage, then independently approves any formal Staging/Release/Active transition through existing RBAC, CSRF, audit and rollback controls. Identical canonical hash means no change. Keep the current Active pointer and last-known-good data usable during failures. The daily timer remains disabled pending separate approval and three successful manual runs.
