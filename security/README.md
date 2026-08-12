# Public repository security gate

Run the complete tracked/worktree/reachable-history scan with:

```bash
npm run security:public
```

The report contains paths, finding types, commits and redacted fingerprints only. Local ignored credentials are warnings because they are not part of the public repository; tracked or reachable-history findings remain blockers.

Gitleaks is used automatically when available. TruffleHog is also used when installed and is otherwise reported as unavailable. The exact false-positive fixtures accepted by the project live in `public-allowlist.yml`; broad directory or secret-pattern exclusions are not permitted.

Optional local hooks can be enabled with:

```bash
git config core.hooksPath .githooks
```

The hooks run the HEAD-only gate. The complete history gate remains mandatory before a public-history rewrite or security release.
