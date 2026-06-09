# Semester Storage Layout

Term-scoped storage lives under `storage/terms/{term}`. Directory names are accepted only after term id validation.

```text
storage/
  term-registry.json
  terms/
    2025-2026-2/
      catalog.json
      majors-index.json
      sync-meta.json
      snapshot-meta.json
    2026-2027-1/
      catalog.json
      majors-index.json
      sync-meta.json
      snapshot-meta.json
  releases/
    active.json
    term-index.json
    {releaseVersion}/
      manifest.json
```

Rules:

- A request for term A only reads term A storage.
- Missing term storage never falls back to another term.
- Legacy global `catalog.json`, `majors-index.json`, and `sync-meta.json` are read only for the legacy current term during compatibility.
- New semester data is written to term storage and release packs, not legacy global files.
- API responses include `term`, `releaseVersion`, `dataAvailable`, and `updatedAt`.

Relevant errors:

- `TERM_NOT_FOUND`
- `TERM_NOT_PUBLISHED`
- `TERM_DISABLED`
- `TERM_CONFIG_INCOMPLETE`
- `TERM_DATA_MISSING`
- `TERM_DATA_MISMATCH`

