# ADP Runtime Control Plane

This directory is the auditable bridge from Repo desired state to CloudBase runtime and Tencent ADP Console observation. It does not add an Agent or CampusTool and never publishes the application.

## State model

- `desired-state/` is the only committed desired-state source: four Agents, prompt source paths, 13 operations, 14 bindings, Main=0 CampusTools, current KB documents, Widget name, multimodal requirement and no-publish invariant.
- `snapshots/current.local.json` is a credential-redacted local observation and is gitignored.
- `CURRENT-STATE-SUMMARY.md` is the committable, identifier-free summary.
- `npm run adp:diff` separates drift into `SAFE_AUTOMATABLE`, `MANUAL_CONSOLE_REQUIRED` and `BLOCKED_UNKNOWN`.
- `npm run adp:apply -- --dry-run` never mutates. A write requires both `--safe --confirm`, an allowlisted action, an explicit UpdateMask and a pre-write rollback snapshot. On this workstation ADP writes remain blocked until a complete observed snapshot proves request shapes.

## Safety invariants

- `CreateRelease`, publish, application/Agent deletion, KB clearing and PR merge are forbidden.
- IDs are read only from environment variables or ignored `desired-state/config.local.json`.
- Prompt and plugin changes use field masks; no full-object overwrite is permitted.
- Snapshots recursively redact authorization, cookies, passwords, API keys, SecretId/SecretKey, tokens and signed URL query values.
- The CloudBase deploy path can only target `campusflowAdpTools`, compares code hashes, stops on failure and performs detail/hash/health checks after a code-only update.

## Commands

```text
npm run adp:snapshot
npm run adp:diff
npm run adp:apply -- --dry-run
npm run adp:apply -- --safe --confirm
npm run adp:deploy:cloudbase -- --dry-run
npm run adp:deploy:cloudbase -- --safe --confirm
npm run adp:audit:plugin -- <zip-path>
npm run adp:preflight
```

`adp:preflight` runs focused control tests, canonical OpenAPI checks, r49-ma, the aggregate ADP kit, the four repository Agent gates, `git diff --check`, then snapshot/diff. An optional export can be included with `npm run adp:preflight -- --plugin <zip-path>`.

## Rollback

- ADP safe apply writes a redacted pre-change snapshot before the first mutation; reapply only its explicitly reviewed Prompt/ToolList fields through Console if rollback is needed.
- CloudBase code updates do not modify function configuration or environment variables. Roll back by deploying the previously recorded Git commit through the same allowlisted code-only command, then repeat health/hash verification.
- Console-only Widget and official vision-tool binding changes are rolled back manually using the click path in `MANUAL-CONSOLE-CHECKLIST.md`.
