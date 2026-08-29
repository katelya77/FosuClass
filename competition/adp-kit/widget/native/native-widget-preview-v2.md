# ADP native Widget preview V2

Observed on 2026-08-11: all six imported Widgets showed the same `Campus Task Widget` card.

Root cause: the previous import bundle used one shared `outputJsonPreview` placeholder for every `.widget`. The imported cards therefore had distinct encoded Template/Schema/Default payloads but identical preview snapshots.

V2 changes only the import preview packaging layer:

- six distinct `outputJsonPreview` trees;
- each preview root is `Card`;
- each preview includes at least one `Button` with `sys.chat`;
- no `Campus Task Widget` or `Untitled widget` placeholder remains;
- encoded Template/Schema/Default stay isolated from 01-04 deterministic business logic.

Bundle SHA256: `602335ae6c64031e228c6168f2adb8b0b9c7d7a77f6136c238ccf1d23f72e546`.

Individual files:

- schedule: `16eedd3266341dcb9e917007f9314a5712f02c38f3f219423d9113f05a05f6ac`
- classroom: `af8665008c32ee433ba340d24f603a2375ac72b2614eb67d9f6765e26711afe9`
- conflict: `37bd92bcbf949a308dc519fe05285fcb8bd2815018ed7f9abb2d68d4dae30d8e`
- day plan: `5c4f3ba3d9b2f27a6de3a7db0cb82f6136aae6464535898ae62503b9af813e16`
- choice: `0af30f1d254bbff6ae2b55e9c1e8637e407332fbc6746de5342361965a055de3`
- recovery: `cfe1abbc7fa731ef2411e386d9b2df12cca4243cf7a38d3388e2bc7dfe43ee4b`

Current gate: `ADP_WIDGET_PREVIEW_V2_REIMPORT_PENDING`.

Preview PASS must not be treated as runtime PASS. After re-import, the next gate is a copied 01 WorkflowPilot using real upstream data and one `sys.chat` handoff.
