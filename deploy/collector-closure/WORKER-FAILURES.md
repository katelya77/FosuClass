# Private worker failure receipts

This change is based on the installed Collector revision
`0af13014d4e937e3395a2e7d35ac2b32b3d7deff`. It preserves CAS, login profiles,
password submission policy, Sample approval, transport, personal Agent and
publication gates. It does not unlock routine/full or resume a failed Sample.

The previous worker discarded child stderr. A failure before `sync.js` loaded
could therefore leave neither progress nor a result, and Oracle only received
`SYNC_FAILED`. The host now preloads a small receipt writer before the actual
worker entry. Module and filesystem errors, timeout phase, missing terminal
receipt, numeric exit and selected process signals have separate private
receipts. Raw messages, stacks, URLs and Session contents are never retained.
Unknown request counts remain unknown. Earlier explicit results are preserved.

For newly approved Samples, the actual browser request route also uses a
durable worker ledger bound to task, term, worker source hash, budget and
approval expiry. Each request consumes its budget before release. A reserved
request without a definite completed response blocks resume. HTTP 401/403 and
429 persist a stop. No request is retried automatically, and an old counter
without its ledger is rejected for review. A host/image source mismatch stops
before worker school navigation. This is a worker request guard; parent login
and Session-probe counts remain separate and are not inferred from it.

The existing direct-source adapter now durably records a target reservation,
received-response digest and parsed output. Completed targets can be reused
only under the same run, term, directory, worker, adapter, parser and term
configuration. Incomplete or failed targets stop for review. Normalized data
is linked to a digest of the decoded source response; original HTML is not
retained, so this digest alone cannot attest original period/week layout.
An ambiguous request consumes budget but is not reported as an exact observed
network request count. Windows/manual acquisition keeps its existing behavior.

`inspect_worker_runtime.py` supports Python 3.6. Container checks use only the
configured image ID with `--pull=never`, `--network=none` and no host mounts.
Native checks use a separate network namespace, the installed Node entry and
an ephemeral empty Session. If network isolation is unavailable, they stop.
Helper process groups are terminated on timeout. No real school Session or
credentials enter the diagnostic. Existing services and failed-run evidence
are not modified. Its default source pin is intentionally the installed base;
it is a pre-upgrade diagnostic, not acceptance of a future revision.

Validation includes import-time failure in a real Node child, an exit without
a receipt, preservation of prior results, safe code classification and no
Collector receipt for Windows/manual mode. CI additionally runs the actual
sync module import and browser-context lifecycle in a network-disabled,
read-only image. These tests do not establish a live school Session or a
successful Sample upload.

Before any subsequent school operation, preserve the failed run, obtain a new
independent scope approval and use a new task ID. An existing school-access
reservation cannot be replayed. Class and four-source reviews still require
actual Oracle receipts and human comparison evidence. The formal incremental
requirements remain in PR #96's `deploy/collector-closure/FORMAL-SCOPE.md`;
reviewed incremental hash selection and a signed formal-scope contract are
still missing and must precede activation.
The new worker ledger is not a claim of per-target incremental completion,
school-wide coverage, parsed-data recovery, or formal upload/review readiness.

This is source/CI preparation only. Installation and school access require
their respective independent approval. No timer, production release or
Active pointer is changed.
