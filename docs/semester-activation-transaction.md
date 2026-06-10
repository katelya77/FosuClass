# Semester Activation Transaction

Semester activation is managed by `server/src/services/semesterActivationTransactionService.js`.

Before activation it backs up:

- `releases/active.json`
- `snapshots/current.json`
- `snapshots/current.json.gz`
- `releases/term-index.json`
- `term-registry.json`
- `admin-config.json`
- `public/runtime/active.json`

The transaction blocks activation when:

- the target term is missing
- the term is not `ready` or `current`
- the registry release version does not match the requested release
- the release manifest term does not match the target term
- release pack quick health is not healthy
- required static release files are missing

If any write fails, all backed-up files are restored and caches are cleared. Activation is serialized through an in-process queue to avoid lost updates between concurrent activation requests.
