# FosuClass relay agent

Relay Agent lets a campus-network machine execute a local sync task on behalf of
an administrator. It does not send cookies, passwords, CAS tickets, or local
teaching-system sessions to the VPS.

## Run

```powershell
npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2025-2026-2
```

The token can:

- read one relay task;
- report heartbeat, version, network diagnosis, login state, phase, progress,
  failed targets, and upload progress;
- upload candidate staging JSON;
- receive cancellation.

The token cannot:

- access `/api/admin/*`;
- publish or activate releases;
- read administrator configuration;
- read or transmit local campus cookies/passwords.

## Task types

Admin-created tasks may request:

- `sync:daily`
- `sync:daily:classes`
- `sync:daily:teachers`
- `sync:daily:classrooms`
- `sync:daily:courses`
- `sync:new-term`

Only one heavy task should run on a machine at a time. If the admin cancels a
task, the agent stops at the next phase boundary or heartbeat check.

## Logs

Logs must be redacted. Do not print prompt text containing identity data, Cookie,
JSESSIONID, CAS ticket, password, API token, or relay token values.
