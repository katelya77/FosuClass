# Admin sync operations center

The admin sync page is an operations center, not a VPS crawler.

## Recommended task cards

The page fetches `/api/admin/sync/command-guide` and renders PowerShell-first
commands for:

- daily all dynamic schedules;
- class schedules only;
- teacher schedules only;
- classroom schedules only;
- course schedules only;
- selected scopes;
- new term full collection;
- explicit staging upload;
- resume.

Each card exposes whether it accesses the 100 net, uses catalog cache, uses
dynamic cache, uploads, publishes, activates, estimated requests, risk, duration,
scene, failure reason, and recovery suggestion.

## Relay status

Relay tasks show task type, token command, status, phase, progress, Agent
version, heartbeat, upload count, cancel, revoke, and delete actions. If no
Agent is online, administrators should copy the local PowerShell command instead
of clicking a fake server-side crawl action.

## Closed loop

A successful operation is not just "upload succeeded". The final state must show:

1. local crawl complete;
2. staging upload complete;
3. data validation complete;
4. release pack built;
5. static release built;
6. OpenResty sync complete;
7. term registry bound;
8. runtime pointer active;
9. mini program probe passed;
10. active release version.
