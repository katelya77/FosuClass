# Incremental planning candidate

This candidate is based on production Sample commit `7ad3b2708ce553e6fff099fd881a4b9c86ebea39`. It is not deployed, does not unlock routine/full and provides no evidence of real school collection.

The existing Collector admin page now displays the persisted class/four human-review prerequisites. A protected, audited `preview-incremental` action accepts a bounded directory scope and returns source-specific selected/request-needed/reviewed-candidate counts and a conservative request budget. It does not queue, request school data, store course facts or publish. A last-reviewed hash is a freshness candidate, not a claim that an unrequested timetable is current. Catalog/probe figures supplied in a draft still require real evidence and independent scope approval.

The deterministic recovery planner binds run ID, term, catalog, source revision and immutable scope hash. Completed/failed reservations conserve the original budget. Unknown pending requests, unparsed responses, changed bindings and expired approvals stop without automatic replay. Canonical content and decoded-response digests are required before reusing a parsed checkpoint. Per-target upload keys bind run/term/source/target/canonical hash for later integration with the existing signed transport.

The runtime stays locked even after both Sample reviews. The existing CLI still rejects routine/full; the backend also rejects formal queueing until its actual executor is ready. Separate school scope, rate/retention policy and independent publication remain required.

Still missing before formal execution: real reviewed catalog/target evidence, authoritative per-target review lookup, signed formal-scope ingestion by WYZ, durable progress integration with actual acquisition, per-target signed upload receipt reconciliation, original-layout fidelity and four-source relationship checks, followed by production deployment approval. These pure planning helpers are executable and tested; they are not a complete school-wide incremental runner.

Sample collection continues on the accepted PR97 WYZ source and unchanged production Sample backend. This planning candidate is independent of the host-only next-Sample entry and must not force another Collector installation.
