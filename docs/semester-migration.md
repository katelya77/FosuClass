# Semester Migration

Migration is one-time, idempotent, and recoverable.

When `term-registry.json` does not exist, startup tries to migrate from the current production state:

1. Read `releases/active.json`.
2. Read the active release manifest.
3. Prefer manifest `term`, `semester`, `termConfig`, `releaseVersion`, and publish timestamps.
4. If the active release is `2025-2026-2` and the manifest lacks `termConfig`, use the labelled legacy compatibility fallback.
5. Copy legacy `catalog.json`, `majors-index.json`, and `sync-meta.json` into `terms/2025-2026-2/` when safe.
6. Write `term-registry-migration-report.json`.

The migration does not delete old files. Repeated startup does not overwrite an existing registry. If migration fails, the service continues in single-term compatibility mode and records a structured warning.

Future terms are never assigned guessed start dates during migration.

