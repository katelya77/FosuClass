# Multimodal Runtime Reachability

| State | Result | Evidence |
|---|---|---|
| `REPO_CONTRACT_READY` | YES | `r51/vision/` contract/intake/security and Main bounded prompt rule exist and are covered by repository tests. |
| `CONSOLE_TOOL_BOUND` | UNKNOWN | No authenticated ADP snapshot with complete local non-secret IDs is available in this run. |
| `LIVE_IMAGE_OBSERVED` | NO | No user-provided ADP Preview image result was supplied. |
| `LIVE_DYNAMIC_VERIFIED` | NO | Without a live image observation, the image → Main → CampusTools verification chain cannot be claimed. |

Repo presence is not live proof. `LIVE_IMAGE_OBSERVED` may only become YES after the user binds the official image-understanding tool to Main and supplies a real Preview result; `LIVE_DYNAMIC_VERIFIED` additionally requires the resulting structured candidate to be checked by CampusTools or the Personal Schedule bridge.
