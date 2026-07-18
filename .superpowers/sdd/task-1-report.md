# Task 1 Report: Versioned Rollout Manifest and Vue Write Guard

## RED evidence

### Runtime mapping

Command: npm run test:admin-capabilities

Result: exit 1, as expected before implementation.

    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    null !== 'settings'
    at tools/test-admin-capabilities.js:77

This demonstrated that /settings did not resolve to the settings write module.

### AST route guard

Command: node tools/test-admin-next-write-route-guard.js

Result: exit 1, as expected before implementation.

    Error: Cannot find module './lib/admin-rollout-manifest'
    Require stack:
    - tools/test-admin-next-write-route-guard.js

The guard contains temporary in-memory fixtures proving that an unknown literal route, a dynamic write path, and a dynamic method are rejected.

## GREEN evidence

Commands:

    npm run test:admin-capabilities
    npm run test:admin-next-write-route-guard
    npm run test:config-migration-safe

Final failure-propagating run: exit 0.

    Admin capabilities tests passed.
    Admin next write route guard passed (14 writes).
    Config migration-safe tests passed.

test:config-migration-safe emitted its expected migration warning/error log entries while asserting soft and hard validation behavior. npm also emitted the pre-existing local electron_mirror configuration deprecation warning.

git diff --check also completed with exit 0.

## Changed files

- config/admin-rollout-manifest.json: C1 rollout manifest, fixed legacy primary/Next enabled/browser image target, all known write modules and route prefixes, retaining only the proven Phase B production grants.
- tools/lib/admin-rollout-manifest.js: validated manifest loader and route-to-module resolver.
- server/src/services/adminCapabilitiesService.js: obtains known modules, production subset, and path resolution from the manifest while retaining its public exports.
- tools/test-admin-capabilities.js: regression coverage for /settings, /settings/preview, and unknown Vue writes.
- tools/test-admin-next-write-route-guard.js: TypeScript-AST scanner for Vue scripts and TypeScript sources, including failure fixtures.
- package.json: test:admin-next-write-route-guard script.

## Self-review and concerns

- Catalog, quality, and settings remain production-disabled; the established Phase B grants remain enabled, and FOSU_ADMIN_NEXT_WRITE_MODULES=* remains forbidden in production.
- Login/logout are intentionally excluded from the source guard because the runtime gate treats them as authentication exceptions, not rollout modules.
- The evidence paths in the C1 manifest use the planned C1 evidence filenames specified by the task brief where required; those future evidence scripts are not created by this foundation task.
- No Release, Active Pointer, term, miniprogram, secret, or image-target production settings were changed.

## Review-fix RED/GREEN evidence

### RED

The independent review fixes each began with a failing focused regression.

    npm run test:admin-rollout-runtime-contract
    AssertionError: final runtime must copy the rollout manifest loader to /app/tools/lib

    npm run test:admin-capabilities
    AssertionError: production must retain only proven Phase B modules
    actual: []
    expected: ["audit", "backups", "content", "feedback"]

    npm run test:admin-next-write-route-guard
    AssertionError: combined dynamic path and method must report both failures

### GREEN

After the fixes, the following failure-propagating verification completed with exit 0.

    npm run test:admin-capabilities
    Admin capabilities tests passed.
    npm run test:admin-next-write-route-guard
    Admin next write route guard passed (14 writes).
    npm run test:config-migration-safe
    Config migration-safe tests passed.
    npm run test:admin-rollout-runtime-contract
    Admin rollout runtime Docker contract passed.
    node tools/test-server-docker-smoke.js
    Docker is not available for server smoke test. Skipping outside CI.
    git diff --check

The final Docker stage now copies the loader to /app/tools/lib and the manifest to /app/config, matching the existing service import and loader resolution. Static contract coverage verifies those paths without requiring a local Docker daemon.

The manifest restores production writes for content, feedback, audit, and backups only. Catalog, quality, and settings remain production-disabled. The source guard now reports both a dynamic method and dynamic path failure unless the call is the narrowly identified fetch transport wrapper in admin-web/src/shared/api/client.ts.
