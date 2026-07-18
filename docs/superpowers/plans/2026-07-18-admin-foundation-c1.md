# Admin Foundation and C1 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the admin migration safety foundation and deliver fully verified Catalog, Quality, and Settings while keeping Legacy primary and production rollback intact.

**Architecture:** Keep the Express data plane and Strangler routes. A versioned JSON rollout manifest drives runtime write gates, generated migration evidence, CI, Compose deployment, and the selected immutable image target. Mutable `/app/data` becomes a verified durable mount; Vue uses typed domain clients over shared Express services.

**Tech Stack:** Node.js 20/22, Express 4, Vue 3, TypeScript, Vitest, Playwright, Docker BuildKit/Compose, GitHub Actions, GHCR.

## Global Constraints

- `FOSU_ADMIN_PRIMARY=legacy` always.
- `FOSU_ADMIN_NEXT_ENABLED=true` always.
- Do not publish a GitHub Release, switch Active Pointer, activate a term, delete Legacy, or modify miniprogram production data.
- Do not edit server keys or GitHub Secrets.
- Unknown Vue mutation paths fail closed.
- Production Compose uses a private GHCR image pinned by exact digest and contains no `build:`.
- Production deploy executes `pull` then `up -d --no-build`; failed smoke restores the previous healthy digest.
- Deploy `browser` target until complete APaaS personal-import evidence proves Chromium is unnecessary.
- C1 production writes remain disabled until the real HTTP and Playwright gates pass.
- Every behavior change follows RED → GREEN → REFACTOR and receives fresh verification before commit.

---

### Task 1: Versioned Rollout Manifest and Vue Write Guard

**Files:**

- Create: `config/admin-rollout-manifest.json`
- Create: `tools/lib/admin-rollout-manifest.js`
- Create: `tools/test-admin-next-write-route-guard.js`
- Modify: `server/src/services/adminCapabilitiesService.js`
- Modify: `tools/test-admin-capabilities.js`
- Modify: `package.json`

**Interfaces:**

- Produces `loadAdminRolloutManifest(): ValidatedManifest` and `resolveWriteModule(path): string | null`.
- Produces CLI `node tools/test-admin-next-write-route-guard.js` that scans `.ts` and Vue scripts using TypeScript AST.
- Runtime consumes manifest `modules[].routes` and environment module subset.

- [ ] **Step 1: Write failing runtime mapping tests**

Add assertions equivalent to:

```js
assert.strictEqual(resolveModuleForPath('/settings'), 'settings');
assert.strictEqual(resolveModuleForPath('/settings/preview'), 'settings');
assert.strictEqual(resolveModuleForPath('/unknown-write'), null);
process.env.FOSU_ADMIN_NEXT_WRITE_MODULES = 'catalog,quality,settings';
assert.strictEqual(assertNextWriteAllowed(nextReq('POST', '/settings')).ok, true);
assert.strictEqual(assertNextWriteAllowed(nextReq('POST', '/unknown-write')).ok, false);
```

- [ ] **Step 2: Run RED**

Run: `npm run test:admin-capabilities`

Expected: FAIL because `/settings` resolves to no module.

- [ ] **Step 3: Write failing AST source guard**

The scanner must enumerate every literal non-GET `api()`/`fetch()` call and assert exactly one manifest mapping. Add a temporary fixture assertion for an unknown path and a dynamic method/path failure.

- [ ] **Step 4: Run RED**

Run: `node tools/test-admin-next-write-route-guard.js`

Expected: FAIL until the manifest loader and source mapping exist.

- [ ] **Step 5: Add the validated manifest and runtime loader**

Manifest fields must include:

```json
{
  "schemaVersion": 1,
  "rolloutVersion": "2026-07-18.c1-foundation.1",
  "admin": { "primary": "legacy", "nextEnabled": true },
  "imageTarget": "browser",
  "modules": {
    "settings": {
      "productionWriteEnabled": false,
      "routes": ["/settings"],
      "httpEvidence": ["tools/test-admin-c1-http.js"],
      "browserEvidence": ["admin-web/scripts/playwright-c1-acceptance.mjs"]
    }
  }
}
```

Include every existing known write module and all current route prefixes. The loader rejects missing schema fields, duplicate routes, unknown production modules, non-legacy primary, disabled Next UI, and any `imageTarget` other than `core|browser`.

- [ ] **Step 6: Replace duplicated path rules and implement AST scan**

Keep the public `adminCapabilitiesService` API stable. Ensure unknown Next mutations return `MODULE_WRITE_DISABLED` and production `*` remains forbidden.

- [ ] **Step 7: Run GREEN and regression suite**

Run:

```powershell
npm run test:admin-capabilities
npm run test:admin-next-write-route-guard
npm run test:config-migration-safe
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

Commit: `feat(admin): centralize rollout and write route guards`

---

### Task 2: Real Express C1 Security and Concurrency Contract

**Files:**

- Create: `tools/test-admin-c1-http.js`
- Create: `tools/test-helpers/admin-http-harness.js`
- Modify: `server/src/security/adminRouteScopes.js`
- Modify: `server/src/services/serviceTokenService.js`
- Modify: `server/src/services/adminAuth.js`
- Modify: `server/src/routes/admin.js`
- Modify: `package.json`

**Interfaces:**

- Test harness starts the real exported Express app with temporary storage/data and returns `{baseUrl, request, login, close, paths}`.
- C1 routes require explicit `catalog:write`, `quality:write`, or `settings:write`; `admin:full` remains compatible.

- [ ] **Step 1: Write the failing real HTTP table test**

For Catalog, Quality, and Settings assert:

```js
await expectStatus(anonymousWrite, 401);
await expectStatus(cookieWithoutCsrf, 403);
await expectStatus(cookieWithBadOrigin, 403);
await expectStatus(scopedTokenWithoutDomainScope, 403);
await expectStatus(nextModuleDisabled, 403);
await expectStatus(nextUnknownMutation, 403);
await expectStatus(nextMissingIfMatch, 428);
await expectStatus(nextStaleIfMatch, 409);
await expectStatus(nextValidWrite, 200);
```

Also assert one audit record and one recoverable pre-write backup per successful mutation, no backup for 428/409/validation errors, and only one of two same-version concurrent writes succeeds.

- [ ] **Step 2: Run RED**

Run: `node tools/test-admin-c1-http.js`

Expected: FAIL on Settings mapping/security coverage, missing explicit scopes, and backup timing.

- [ ] **Step 3: Add explicit route scopes and security-event parity**

Map C1 mutations to their domain scopes. Record Origin/CSRF/scope rejection through the existing security event service without logging tokens, cookies, or bodies.

- [ ] **Step 4: Move backups behind validation/CAS without losing pre-write state**

Introduce service preparation methods where required:

```js
const prepared = service.prepareMutation(body, { ifMatch, requireIfMatch: true });
createBackup(type, sourcePath);
const result = service.commitPreparedMutation(prepared);
```

The prepared object contains the validated current version and data; commit rechecks the version immediately before atomic replace.

- [ ] **Step 5: Run GREEN and existing parity suites**

Run:

```powershell
npm run test:admin-c1-http
npm run test:admin-http-write-parity
npm run test:admin-auth-modes
npm run test:service-token-route-matrix
npm run test:admin-backup-transaction
```

- [ ] **Step 6: Commit**

Commit: `test(admin): enforce real C1 HTTP write contracts`

---

### Task 3: Quality Ignore Contract and Asynchronous Recheck

**Files:**

- Create: `server/src/modules/quality/repository.js`
- Create: `server/src/modules/quality/reportService.js`
- Modify: `server/src/modules/quality/service.js`
- Modify: `server/src/routes/admin.js`
- Modify: `tools/test-admin-c1-modules.js`
- Modify: `tools/test-admin-c1-http.js`

**Interfaces:**

- `buildQualityReport(): {active, ignored, summary, generatedAt}`.
- `startQualityRecheck(): Job`; `getQualityRecheck(id): Job` using the existing job manager pattern.
- Canonical fingerprint: `${type}::${target}`.

- [ ] **Step 1: Add failing contract tests**

Seed an anomaly and a new-format ignore rule. Assert the anomaly moves from `active` to `ignored`, reason/status are returned, recovery moves it back, and stale recovery returns 409. Assert recheck start returns before work completes and status becomes success/failure.

- [ ] **Step 2: Run RED**

Run: `npm run test:admin-c1-modules && npm run test:admin-c1-http`

Expected: FAIL because the report reads the old array contract and no recheck route exists.

- [ ] **Step 3: Implement repository/report boundaries and job routes**

Use the quality repository for all reads/writes. Do not write Active Pointer, releases, term state, or timetable source data.

- [ ] **Step 4: Run GREEN**

Run the two Task 3 commands plus `npm run test:tier3-failure-isolation`.

- [ ] **Step 5: Commit**

Commit: `fix(admin): close quality ignore and recheck loop`

---

### Task 4: Catalog Import, Export, Relationships, Pagination, and Rebuild Job

**Files:**

- Create: `server/src/modules/catalog/repository.js`
- Create: `server/src/modules/catalog/importService.js`
- Create: `server/src/modules/catalog/contracts.js`
- Modify: `server/src/modules/catalog/service.js`
- Modify: `server/src/routes/admin.js`
- Modify: `tools/test-admin-c1-modules.js`
- Modify: `tools/test-admin-c1-http.js`

**Interfaces:**

- `listResources(query): {items,total,page,pageSize,totalPages}` with page/pageSize bounds.
- `getRelationships(): {colleges:[{id,name,grades:[{grade,majors:[]}]}]}`.
- `previewImport(document): {previewId,baseVersion,sourceFingerprint,summary,changes,warnings}`.
- `applyImport(previewId,{ifMatch,confirm}): {version,summary}`; deletes refused unless the contract later explicitly allows them.
- Export endpoint streams/returns JSON or CSV using the same normalized rows.

- [ ] **Step 1: Write failing service and HTTP tests**

Cover all five resource shapes, stable row ids, page 1 reset semantics in client contracts, bounded `pageSize`, last-page metadata, JSON/CSV export headers, invalid import rejection, deterministic diff, preview fingerprint tamper rejection, 428, 409, backup, audit, and async rebuild job status.

- [ ] **Step 2: Run RED**

Run: `npm run test:admin-c1-modules && npm run test:admin-c1-http`

- [ ] **Step 3: Implement repository, import preview/apply, relationships, export, and job adapters**

Reuse existing storage files and release worker. Rebuild may rebuild an index/release pack only; it must not publish or activate.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
npm run test:admin-c1-modules
npm run test:admin-c1-http
npm run test:release-index-rebuild
npm run test:admin-release-pack-jobs
```

- [ ] **Step 5: Commit**

Commit: `feat(admin): complete catalog operations contract`

---

### Task 5: Deterministic Feature Matrix and Check Mode

**Files:**

- Create: `tools/lib/admin-route-scanner.js`
- Modify: `tools/generate-admin-feature-matrix.js`
- Modify: `tools/test-admin-feature-matrix.js`
- Modify: `tools/test-admin-matrix-freshness.js`
- Modify: `tools/test-admin-matrix-status-evidence.js`
- Modify: `docs/admin-migration/feature-matrix.json`
- Modify: `docs/admin-migration/api-contracts.json`
- Modify: `docs/admin-migration/legacy-feature-inventory.md`
- Modify: `package.json`
- Modify: `.github/workflows/admin-modernization-ci.yml`

**Interfaces:**

- `scanAdminRoutes(root): RouteRecord[]` scans route and module route files with mount prefixes.
- `computeInputFingerprint(inputs): sha256` excludes HEAD/time/outputs.
- CLI supports `--out-dir <dir>` and `--check`.

- [ ] **Step 1: Write failing scanner/freshness/check tests**

Assert module routes such as audit/dashboard are found, two identical generations are byte-identical, changing HEAD alone does not change output, changing a route/manifest input changes fingerprint, and `--check` leaves `git status` clean.

- [ ] **Step 2: Run RED**

Run: `npm run test:admin-feature-matrix && npm run test:admin-matrix-freshness`

- [ ] **Step 3: Implement stable generation**

Replace `generatedAt`/`sourceCommit` with `inputFingerprint`, `generatorVersion`, and deterministic metadata derived from inputs. Inventory prose must display fingerprint rather than wall time/commit.

- [ ] **Step 4: Regenerate once and run check mode**

Run:

```powershell
npm run admin:feature-matrix:generate
npm run admin:feature-matrix:check
git diff --exit-code -- docs/admin-migration
```

Expected: generation updates committed artifacts once; the subsequent check produces no diff.

- [ ] **Step 5: Commit**

Commit: `build(admin): make migration evidence deterministic`

---

### Task 6: Durable `/app/data`, Seed Separation, and Migration Proof

**Files:**

- Create: `server/src/services/runtimeDataBootstrapService.js`
- Create: `server/scripts/bootstrap-runtime-data.js`
- Create: `server/scripts/migrate-runtime-data.js`
- Create: `server/scripts/verify-runtime-persistence.js`
- Create: `tools/test-runtime-data-bootstrap.js`
- Create: `tools/test-runtime-data-migration.js`
- Create: `tools/test-runtime-data-recreate.js`
- Modify: `server/src/services/ai/knowledgeBaseService.js`
- Modify: `server/src/services/ai/campusMapVersionService.js`
- Modify: other hard-coded mutable `server/data`/storage paths found by the audit
- Modify: `server/Dockerfile`
- Modify: `server/docker-compose.yml`
- Create: `server/docker-compose.dev.yml`
- Modify: `.dockerignore`
- Modify: `server/.dockerignore`
- Modify: `package.json`

**Interfaces:**

- `bootstrapRuntimeData({seedDir,dataDir})` copies missing files only and returns a manifest.
- Migration CLI requires explicit `--source-container` and `--target-dir`, writes UTC backup + SHA-256 manifest + marker, and refuses unsafe non-empty targets.
- Persistence verifier checks Docker mount identity and named durable files before/after recreate.

- [ ] **Step 1: Write failing seed and migration tests**

Tests assert seed copy on empty target, no overwrite on non-empty target, timestamped backup, per-file SHA-256, target hash verification, refusal of an unmarked non-empty target, and marker provenance.

- [ ] **Step 2: Run RED**

Run: `npm run test:runtime-data-bootstrap && npm run test:runtime-data-migration`

- [ ] **Step 3: Implement runtime path unification and seed separation**

Image copies `server/data` to `/app/seed-data`; runtime `/app/data` is created by Compose mount and bootstrapped only for missing seed files. Mutable KB/map paths honor `FOSU_DATA_DIR`.

- [ ] **Step 4: Make production Compose immutable**

`server/docker-compose.yml` must contain:

```yaml
image: ${FOSU_API_IMAGE:?exact GHCR digest required}
pull_policy: always
volumes:
  - ./storage:/app/storage
  - ./data:/app/data
```

It must not contain `build:`. Local build moves to `docker-compose.dev.yml`.

- [ ] **Step 5: Run local Docker recreate proof**

Run `npm run test:runtime-data-recreate`. The test uses a unique temporary Compose project, writes non-production fixtures for audit/backup/config/job/sync history, force-recreates with `--no-build`, rechecks hashes, then removes only that temporary project.

If Docker is unavailable, report the test as `UNKNOWN`, not success, and keep the deployment merge gate closed.

- [ ] **Step 6: Commit**

Commit: `feat(runtime): persist and migrate container data safely`

---

### Task 7: ARM64 Core/Browser Images and One Digest Delivery Workflow

**Files:**

- Modify: `server/Dockerfile`
- Modify: `.github/workflows/deploy-vps.yml`
- Delete: `.github/workflows/container-publish.yml`
- Create: `server/scripts/deploy-digest.sh`
- Create: `tools/test-production-delivery-contract.js`
- Modify: `tools/test-server-docker-smoke.js`
- Modify: `tools/test-docker-secret-scan.js`
- Modify: `package.json`

**Interfaces:**

- Docker targets: `core` and `browser`; `browser FROM core` and adds Chromium packages.
- Workflow job outputs `core_digest`, `browser_digest`, and `selected_digest`.
- Remote deploy script records `previous-image.txt` and updates `current-image.txt` only after health succeeds.

- [ ] **Step 1: Write failing delivery contract tests**

Assert one `main` push workflow, job dependency order, concurrency, ARM64 targets, exact digest selection, no production `build:`, `pull` + `up --no-build`, temporary Docker auth, automatic rollback, Legacy primary, Next enabled, and manifest-derived modules/target.

- [ ] **Step 2: Run RED**

Run: `npm run test:production-delivery-contract`

Expected: FAIL on two competing push workflows, local build, missing persistence migration, and missing rollback.

- [ ] **Step 3: Add Docker targets and build smoke**

Build both targets for the local platform where possible. Run the complete APaaS parser/import suite against browser. Core is not selected for production.

- [ ] **Step 4: Consolidate GitHub Actions**

PR tests remain in admin CI. `main` delivery runs tests, builds/pushes both ARM64 targets, captures digests, deploys the manifest-selected digest, performs migration/persistence preflight, measures old/core/browser image sizes and layers on VPS, smokes, and rolls back on failure.

Deploy job permissions:

```yaml
permissions:
  contents: read
  packages: read
```

Remote login uses a temporary `DOCKER_CONFIG` and the job-scoped token.

- [ ] **Step 5: Run GREEN and Docker checks**

Run:

```powershell
npm run test:production-delivery-contract
npm run test:docker-secret-scan
npm run test:server-docker-smoke
npm run test:fosu-apaas-import
docker compose -f server/docker-compose.yml config
```

- [ ] **Step 6: Commit**

Commit: `ci(deploy): deliver immutable ARM64 digests with rollback`

---

### Task 8: Typed Vue C1 Experience and Real Page Playwright

**Files:**

- Create: `admin-web/src/features/catalog/api.ts`
- Create: `admin-web/src/features/catalog/types.ts`
- Create: `admin-web/src/features/quality/api.ts`
- Create: `admin-web/src/features/quality/types.ts`
- Create: `admin-web/src/features/settings/api.ts`
- Create: `admin-web/src/features/settings/types.ts`
- Create: `admin-web/src/pages/CatalogPage.test.ts`
- Create: `admin-web/src/pages/QualityPage.test.ts`
- Create: `admin-web/src/pages/SettingsPage.test.ts`
- Create: `admin-web/scripts/playwright-c1-acceptance.mjs`
- Modify: `admin-web/src/pages/CatalogPage.vue`
- Modify: `admin-web/src/pages/QualityPage.vue`
- Modify: `admin-web/src/pages/SettingsPage.vue`
- Modify: `admin-web/src/shared/ui/AppFormField.vue`
- Modify: `admin-web/src/shared/ui/AppModal.vue`
- Modify: `admin-web/src/shared/ui/AppTable.vue`
- Modify: `admin-web/src/styles/tokens.css`
- Modify: `.github/workflows/admin-modernization-ci.yml`
- Modify: `package.json`

**Interfaces:**

- Pages import only typed feature clients.
- Conflict state exposes reload/reapply actions.
- Catalog import uses file chooser, preview result, explicit apply confirmation, and job polling.
- Quality exposes active/ignored tabs, reason input, restore, and recheck status.

- [ ] **Step 1: Write failing component tests**

Catalog: per-type columns, last-page disable, filter page reset, import preview/apply, relationships, export, rebuild polling.

Quality: current ignored state/reason, required reason, restore, 409 recovery, recheck polling.

Settings: discriminated controls, Chinese groups, associated labels, validation alert, preview error handling, 409 three-way conflict and reapply.

- [ ] **Step 2: Run RED**

Run: `npm run admin:test`

- [ ] **Step 3: Implement typed clients and shared accessible UI**

Preserve the warm operational visual system. Add stable ids, focus capture/restore, visible state, mobile priority/card views, `aria-live`, and reduced-motion behavior.

- [ ] **Step 4: Extend real browser acceptance**

Start the real Express app with isolated data and the committed built Vue bundle. Test login and each C1 page at desktop and 390px, including write flows, conflict recovery, loading/empty/error states, keyboard focus, no horizontal document overflow, and console errors.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
npm run admin:test
npm run admin:build
npm run admin:test:e2e
npm run test:admin-playwright-c1
npm run admin:test:browser
```

- [ ] **Step 6: Enable C1 production write modules in the manifest**

Only after Step 5 passes, change Catalog, Quality, and Settings `productionWriteEnabled` to true, regenerate/check the matrix, and rerun the real HTTP and Playwright suites.

- [ ] **Step 7: Commit**

Commit: `feat(admin): finish C1 operations experience`

---

### Task 9: Full Verification, Review, Draft PR, CI, Merge, and Production Evidence

**Files:**

- Create or modify: `docs/admin-migration/c1-foundation-report.md`
- Modify only defects found by verification/review.

**Interfaces:**

- Report records commands, counts, digests, URLs, sizes, persistence hashes, and every `UNKNOWN` item.

- [ ] **Step 1: Run repository verification from a clean worktree**

Run the exact admin CI suites, config preflight, C1 HTTP, feature-matrix `--check`, Docker contracts, both image builds, persistence recreate, admin unit/build/e2e, and both Playwright suites. Record exit codes and counts.

- [ ] **Step 2: Dispatch whole-branch code review**

Review the diff from merge-base `origin/main` to `HEAD` against this plan and design. Fix every Critical and Important issue, rerun covering tests, and re-review.

- [ ] **Step 3: Verify no unrelated files and atomic commit history**

Run:

```powershell
git status --short
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
```

- [ ] **Step 4: Push and create Draft PR**

Push `codex/admin-foundation-c1`. Create a Draft PR containing root causes, architecture, persistence procedure, rollback behavior, tests, and explicit non-goals.

- [ ] **Step 5: Run and repair CI**

Inspect Actions logs with `gh`, fix only evidenced root causes, push atomic commits, and repeat until all required checks are green.

- [ ] **Step 6: Resolve review gate**

Fetch thread-aware review state. Fix all actionable unresolved comments. Do not mark ready or merge while a required check is pending/failing or a review thread remains unresolved.

- [ ] **Step 7: Squash merge only if every gate passes**

Confirm production preflight, exact selected digest capability, Legacy primary, Next enabled, migration safety, and rollback script. Squash merge with expected head SHA.

- [ ] **Step 8: Observe the single delivery workflow**

Capture published core/browser digests, selected production digest, previous/rollback digest, VPS old/core/browser compressed and unpacked sizes/layers, migration backup/SHA256, recreate persistence proof, and public smoke results.

If delivery fails, confirm automatic rollback and Legacy availability. Do not switch Active Pointer or enter Phase D.

- [ ] **Step 9: Complete report and goal**

The report must include latest main/PR/Actions, modified files, architecture change, Legacy/Vue difference, C1 matrix, persistence migration, recreate proof, image comparison, publish/production/rollback digests, online entry, tests, incomplete items, and next-phase advice. Use `UNKNOWN` wherever evidence could not be obtained.
