# One-click Runbook

## First use

1. Copy `desired-state/config.local.example.json` to `desired-state/config.local.json` and fill only the non-secret ADP IDs. The local file is ignored by Git.
2. Keep Tencent credentials in the already authenticated CLI context; never paste them into the config.
3. Run `npm run adp:preflight`.

The preflight stops on a repository gate failure. ADP snapshot absence is reported as `BLOCKED/UNKNOWN`, not converted into a pass.

## Review and apply

1. Read `CURRENT-STATE-SUMMARY.md` and the output of `npm run adp:diff`.
2. Preview ADP changes with `npm run adp:apply -- --dry-run`.
3. Only after the snapshot is observed and every field mask is expected, use `npm run adp:apply -- --safe --confirm`. If the API shape is not proven, use the manual checklist instead.
4. Preview CloudBase with `npm run adp:deploy:cloudbase -- --dry-run`. `NO_CHANGE` performs no deployment; `DEPLOY_CHANGED_CODE` is the only deployable state.
5. A reviewed code-only deployment is `npm run adp:deploy:cloudbase -- --safe --confirm`. Failure stops the sequence before any ADP Console change.
6. Export the plugin ZIP and run `npm run adp:audit:plugin -- <zip-path>`.
7. Repeat `npm run adp:snapshot` and `npm run adp:diff`. Do not publish.

## Expected success

- 4 Agents; 13 public CampusTools; 14 bindings; Main has 0 CampusTools.
- Exactly six operations expose `decisionPreferences` input and `decision` output.
- Main alone has the official image-understanding tool.
- Prompts match Repo hashes.
- No release or active legacy workflow drift.
- Export descriptions contain stable business wording rather than development versions.
