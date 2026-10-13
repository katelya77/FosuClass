# Installed WYZ Sample closure

This host-local wrapper reuses installed revision `f076eac3b28ff4b03bd05c642672918a0d699376` and the signed Oracle Sample protocol at `7ad3b2708ce553e6fff099fd881a4b9c86ebea39`. It does not install a Collector, change credentials, enable its timer, or publish data. It requires the exact successful source-upgrade receipt, completed transaction, bundle SHA and current critical source-file hashes. The retired run `sc-506d1f4bea522471cf93edc6` is always rejected.

Before each independently approved Sample, transfer the current successful Oracle **production** preflight JSON into a root-only WYZ file. It expires after 30 minutes. Create the exact Sample in the protected Oracle admin page, noting its run ID, term and request budget. The wrapper verifies the signed queued task before any school request and again immediately after login.

For an approved class window, run the following once from the private operational package directory, substituting the approved run ID and real term:

```sh
bash deploy/collector-closure/start-wyz.sh --approve-school-window --kind=class --run-id=sc-APPROVED-RUN --term=2026-2027-1 --request-budget=40 --oracle-preflight=/root/APPROVED/oracle-preflight.json --one-login
```

The detached systemd task survives terminal closure, has a 15-minute budget and never restarts. A durable reservation before school access prohibits replay after a crash. Existing valid Session reuse does not read credentials; an expired Session permits at most one protected-file password submission in this approved window. Failed authentication, CAPTCHA, unexpected requests, Session expiry, changed task or expired approval stops the run.

After the actual class result has been reviewed and confirmed in Oracle, obtain independent four-source approval and create a new `four` task. Use `--kind=four` and append `--class-run-id=sc-REVIEWED-CLASS --class-canonical-hash=<reviewed hash>`; omit `--one-login`. Four sources reuse the Session and cannot submit another password. An expired Session requires a new human decision.

Private receipts are stored under `/root/fosu-collector-closure/<runId>/`. Read `result.json` for signed Oracle receipt comparison and per-source metrics. `executor.log` excludes raw CLI output, passwords and Sessions. `school-access.started.json` means the attempt must not be automatically repeated, even if a terminal receipt is absent. The heartbeat service remains active with execute=0, the timer disabled, and the personal Agent's service contract unchanged.

## What successful upload proves

Every selected source is independently requested with `sourceMode=network-direct`. A class target is one professional/grade request group and can contain several administrative classes. The four selected targets are independent and need not share a course. Upload checks bind run ID, term, private upload ID, canonical hash, request budget and shared integer metrics to Oracle's signed receipt. Samples remain `sampleOnly=true`, `publishable=false`, `coverageValid=false` and cannot publish.

The installed CLI reports collection requests separately from login requests; its Session probes do not expose an exact request counter. Reports retain `NOT_COUNTED_BY_EXISTING_CLI` for that gap. PR97 retains decoded-response digests and parsed checkpoints, but no complete original HTML layout. Therefore normalized data, response digests and matching upload hashes alone do not establish original-layout fidelity, two/three-period correctness or cross-source consistency. Those checks remain pending actual private review. Never attest them from fixtures.

Failures retain the worker phase, typed code, numeric exit/signal and scope-bound request-ledger totals. Missing evidence stays UNKNOWN; an interrupted reservation is counted as consumed, never replayed. `ExecStopPost` records a bounded interruption receipt after timeout or SIGKILL, without school access. The CLI's real protected-file path `school-credentials.json` is fingerprinted privately before/after this task; legacy `credentialsConfigured=false` is not evidence it is absent. The launcher does not reset credentials, Session or authentication history. Rebooted Sample tasks are never resumed automatically.

## Formal collection remains locked

The installed CLI rejects `routine/full` with `SCHOOL_SCOPE_REVIEW_REQUIRED`. The server's Sample readiness and a four-source upload do not unlock it. See [FORMAL-SCOPE.md](FORMAL-SCOPE.md) for the subsequent approval and implementation gates. No wrapper changes this boundary.
