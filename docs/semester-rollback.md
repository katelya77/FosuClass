# Semester Rollback

Rollback uses the previous release recorded in the term release index and the current active pointer backup.

## Automatic Rollback

Activation writes are protected:

- previous `releases/active.json`
- previous `snapshots/current.json`
- previous `snapshots/current.json.gz`
- previous `releases/term-index.json`

If registry, term-index, snapshot, or active pointer update fails during activation, the previous state is restored.

## Manual Rollback

1. Open Admin Console.
2. Inspect `学期管理` readiness for the previous term and rollback release.
3. Bind the rollback release if needed.
4. Activate the previous term only after readiness passes.
5. Verify app-config, active release manifest, term-index, and OpenResty static manifest agree.

## Retention

Registry and term-index references are pinned:

- current term keeps active release and at least two rollback candidates when available
- each archived term keeps at least one healthy release
- ready/planned terms keep their bound candidate releases
- unbound, unpinned, expired releases may be removed by maintenance dry-run

