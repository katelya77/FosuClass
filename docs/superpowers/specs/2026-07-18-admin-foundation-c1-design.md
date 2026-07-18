# FosuClass Admin Foundation and C1 Closure Design

## Status and intent

This design closes the safety foundation and completes C1 without changing the production primary admin, the Active Pointer, the active term, miniprogram production data, or the mature Node/Express data plane.

The user-provided requirements are the approved product and rollout constraints. The implementation remains a Strangler migration:

```text
Legacy UI ─┐
           ├─ HTTP contract ─ Domain route ─ Service ─ Repository/files
Vue UI ────┘
```

The Legacy UI remains the production authority and emergency fallback. Vue receives only explicitly verified write capabilities.

## Verified baseline

- Remote and local `main`: `2c49e09536869c7c21fa8bba5ee867a40c987bcc`.
- Open pull requests: none at audit time.
- Latest two `main` workflows both succeeded, but they run independently: GHCR publish `29608064243` and SCP/local-build deploy `29608064261`.
- The current checkout has unrelated untracked deployment artifacts, so work is isolated in branch `codex/admin-foundation-c1` and a separate worktree.
- Existing admin architecture checks, unit tests, build, smoke, and mock-browser acceptance pass on the baseline.
- Regenerating the Feature Matrix dirties three committed files only because `generatedAt` and the pre-commit `HEAD` change. This proves the freshness check is self-referential.
- Current production Compose mounts `/app/storage` but not `/app/data`; audit logs, backups, sync history, maintenance history, and some mutable AI/map data therefore live in the container writable layer.
- `/settings` and `/settings/preview` are not mapped to the `settings` write module. A Vue request is rejected before the route even when the module is enabled.
- Quality writes the new `{version,rules:[{fingerprint,...}]}` document while the report still reads the old `[{type,target}]` form, so ignore rules do not filter the report.

## Alternatives considered

### A. Versioned JSON Rollout Manifest (selected)

One committed JSON document owns the primary UI, enabled Next UI, known write modules, route-to-module rules, production grants, evidence files, and production image target. Runtime capability checks, Feature Matrix generation, CI checks, and deployment derive from it.

This is selected because Node can load it directly, CI can validate it without a build step, workflows can query it with Node, and diffs are reviewable. It avoids a second generated configuration language.

### B. Generate rollout state from Express and Vue code

This reduces manual manifest maintenance but cannot represent operational intent such as “implemented but production-disabled” or the selected image target. It would also make code structure silently control production rollout. Rejected.

### C. TypeScript manifest shared by the Vue application and server

This gives compile-time types but forces workflows and CommonJS server boot to transpile or duplicate loaders. It makes emergency operational inspection harder. Rejected; JSON is validated by tests and TypeScript types are generated/declared at consumers.

## 1. Rollout truth and write safety

Create `config/admin-rollout-manifest.json` with schema version, rollout version, fixed primary flags, known module records, route prefixes, evidence, and `imageTarget`. The manifest must always assert:

```json
{
  "primary": "legacy",
  "nextEnabled": true,
  "imageTarget": "browser"
}
```

`adminCapabilitiesService` loads and validates this manifest. It compiles route patterns once and rejects unknown Next mutations. `FOSU_ADMIN_NEXT_WRITE_MODULES` may only select a subset of manifest modules; unknown environment names and `*` in production fail configuration validation.

A TypeScript-AST scanner reads every `.ts` and Vue `<script>` block under `admin-web/src`. Every `api()` or native `fetch()` call with a literal non-GET method must have a statically discoverable admin path and exactly one manifest module. Dynamic or unknown writes fail CI. The guard checks the source, not the generated bundle.

C1 modules begin production-disabled in the first test commit. They are changed to production-enabled only after real HTTP and browser suites pass. Legacy requests remain outside the Next module gate.

## 2. C1 HTTP contracts and domain boundaries

Add typed client contracts under each Vue feature directory rather than keeping page-local `Record<string, unknown>` calls. Express routes stay in the existing router for this phase, but business behavior moves behind the existing catalog, quality, and settings services.

The real HTTP suite launches the actual Express app with isolated temporary `FOSU_STORAGE_DIR` and `FOSU_DATA_DIR`. For each C1 write domain it proves:

- cookie session and CSRF success;
- unauthenticated, invalid CSRF, invalid Origin, and insufficient scope rejection;
- Next module disabled rejection and enabled success;
- unknown Next write rejection;
- missing `If-Match` returns 428;
- stale `If-Match` returns 409 and current version;
- a successful write creates an audit entry and a recoverable backup;
- concurrent stale writers cannot both succeed;
- failed validation/precondition requests do not consume backup retention.

The route scope map receives explicit C1 scopes. `admin:full` remains compatible, while least-privilege service tokens can be tested independently.

## 3. Catalog product closure

Catalog provides resource-aware columns and stable row keys for class, teacher, classroom, course, and major. Search/type/filter changes reset to page 1; page size is bounded server-side; Next is disabled when `page * pageSize >= total`.

The UI exposes detail/raw JSON, JSON/CSV export, and a JSON import flow with three explicit stages:

1. Parse and validate an export-compatible document without writing.
2. Return a deterministic diff: creates, updates, unchanged, deletes refused by default, warnings, and a source fingerprint.
3. Apply only with `If-Match`, the preview fingerprint, explicit confirmation, backup, audit, and the catalog module grant.

College/grade/major relationships are returned as a typed tree and rendered as a dedicated relationship view. Index rebuild is an asynchronous existing release job: start, poll by job id, show progress/result, and never activate a release or Active Pointer.

## 4. Quality product closure

The report and ignore service share one canonical fingerprint contract. The report returns both active anomalies and ignored entries with current status and reason. Operators must enter a reason to ignore; recovery removes the rule with optimistic concurrency.

Recheck is asynchronous. It creates a quality recheck job, returns immediately, and exposes status polling. The job recomputes the report only; it does not publish, activate, or alter timetable data.

## 5. Settings product closure

Settings use a discriminated field union (`string`, `enum`, `boolean`, numeric when added), Chinese group metadata, stable input ids, field-level errors, and safe values only. Preview returns the version it was calculated from.

On 409, the client fetches the newest server document and presents local, server, and intended values. Non-conflicting local edits can be reapplied to the newest version; no blind overwrite exists. The page never edits `.env`, server secrets, or GitHub Secrets.

## 6. Stable Feature Matrix

The generator recursively scans:

- `server/src/routes/**`;
- `server/src/modules/**/routes.js` and `routes.ts`;
- explicit mount prefixes declared in one scanner configuration when static analysis cannot infer them.

Freshness is a SHA-256 fingerprint of stable inputs: normalized route records, Vue navigation, rollout manifest, evidence declarations, and generator version. It excludes wall-clock time, `HEAD`, generated files, and output paths.

Normal generation writes deterministic bytes. `--check` generates into a temporary directory and byte-compares all committed artifacts without modifying the worktree. CI fails with a focused diff when they differ.

## 7. Runtime data persistence and first migration

Production runtime data is a bind mount at `/app/data`. Image-provided data moves to `/app/seed-data`. Container bootstrap copies only missing seed files and never overwrites runtime state.

Before the first deployment with the mount, a migration script:

1. Resolves the exact running container and host target.
2. Exports the old container `/app/data` while the old container still exists.
3. Creates a UTC timestamped tar backup and a per-file SHA-256 manifest.
4. Refuses a non-empty unmarked target unless its files match or an explicit migration mode is supplied by the scripted deployment.
5. Copies only missing files, verifies destination hashes, and writes a migration marker containing old container id, old image id/digest, file counts, hashes, and time.
6. Leaves the old container running if any verification fails.

After recreate, deployment verifies Docker mount source/destination and compares durable audit, backup, configuration, job, and sync-history evidence. It must never infer persistence from “directory exists in container”.

## 8. Images and production delivery

The Dockerfile exposes `core` and `browser` targets. `core` contains the API and admin SPA without Chromium packages. `browser` extends `core` with system Chromium/fonts and keeps the current APaaS fallback capability.

Both ARM64 targets are built and pushed. The rollout manifest selects `browser` for production until a complete personal-import regression proves no Chromium dependency. The delivery workflow is a single dependency chain:

```text
tests → build/push core+browser → capture digests → deploy selected digest
      → persistence preflight/migration → pull + up --no-build
      → smoke + recreate persistence proof → record healthy digest
      └─ failure → restore previous healthy digest + smoke
```

The production Compose file contains no `build:` and requires an exact `@sha256:` image. A separate development Compose override retains local build convenience.

The deploy job uses job-scoped `GITHUB_TOKEN` with `packages: read`. Remote Docker login uses a temporary `DOCKER_CONFIG`, logs out, and deletes it on exit. No registry credential is written to the repository, `.env`, Compose, or permanent Docker configuration.

The VPS measures current, core, and browser images with `docker image inspect`, `docker history`, and streamed `docker save | gzip | wc -c` so compressed and unpacked figures are real VPS evidence.

## 9. UI direction and accessibility

Retain the existing warm operational palette and Fosu identity instead of introducing a generic blue SaaS template. The selected direction is a restrained, data-dense operations console: clear hierarchy, precise typography, visible system state, and compact drill-down surfaces.

Shared requirements:

- semantic controls and associated labels;
- visible keyboard focus and modal focus restoration;
- `aria-live`/`role=alert` for errors and jobs;
- loading, empty, partial-failure, conflict, and recovery states;
- 375, 768, 1024, and 1440 px verification;
- mobile card/priority-column alternatives for dense tables;
- no layout-shifting hover effects and reduced-motion support.

## 10. Rollback and stopping rule

Application rollback changes only the exact GHCR digest and recreates the API container using the same durable mounts. Data migration backups are retained and never automatically reversed over newer runtime data.

This phase stops after the foundation and C1 evidence. It does not migrate Security, Provider, KB, Map, Staging, Release, or Term; does not switch Primary; does not publish a GitHub Release; and does not delete Legacy.

## The more important unasked question

The critical issue is not “when is Vue feature-complete?” It is “what observable invariant proves a deployment preserved control-plane state and production data?”

Without a versioned rollout decision, a durable-state manifest, and an immutable deployed digest, CI can be green while three different truths diverge: the UI believes a write is enabled, Express gates a different path, and the VPS runs a locally built image whose container layer owns mutable data. That is the causal mechanism behind the current false confidence. The foundation therefore makes deployed code identity, rollout intent, and durable data independently measurable before adding more migrated pages.
