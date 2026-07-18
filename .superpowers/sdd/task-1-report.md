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

- config/admin-rollout-manifest.json: C1 rollout manifest, fixed legacy primary/Next enabled/browser image target, all known write modules and route prefixes, with every production write flag false.
- tools/lib/admin-rollout-manifest.js: validated manifest loader and route-to-module resolver.
- server/src/services/adminCapabilitiesService.js: obtains known modules, production subset, and path resolution from the manifest while retaining its public exports.
- tools/test-admin-capabilities.js: regression coverage for /settings, /settings/preview, and unknown Vue writes.
- tools/test-admin-next-write-route-guard.js: TypeScript-AST scanner for Vue scripts and TypeScript sources, including failure fixtures.
- package.json: test:admin-next-write-route-guard script.

## Self-review and concerns

- The manifest deliberately leaves every C1 production write flag false; FOSU_ADMIN_NEXT_WRITE_MODULES=* remains forbidden in production.
- Login/logout are intentionally excluded from the source guard because the runtime gate treats them as authentication exceptions, not rollout modules.
- The evidence paths in the C1 manifest use the planned C1 evidence filenames specified by the task brief where required; those future evidence scripts are not created by this foundation task.
- No Release, Active Pointer, term, miniprogram, secret, or image-target production settings were changed.
