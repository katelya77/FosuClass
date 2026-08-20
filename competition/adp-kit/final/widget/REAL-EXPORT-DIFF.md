# Real Widget Export Compatibility Diff

Oracle: `C:\Users\Katelya\Downloads\小序-校园智序结果卡.widget`
SHA-256: `93bbc0b1619ee2bdfbbc7817ad15d3b0ad0a42054a345e35d7ccb290e40ef252`
Widget ID: `601418106a374b2eb7de54c65a3de7e0`

This is the latest post-reimport Tencent export oracle. The previous ID
`978b004b2f054e8bbd5438159c7329ff` is historical only and must not be treated as Console truth.

## Frozen platform structure

- Wrapper keys: version, name, template, jsonSchema, outputJsonPreview, encodedWidget.
- Encoded keys: name, id, view, defaultState, states, schema, three validity fields.
- Outer template may be empty; the live View is encoded inside `encodedWidget`.
- Zod uses reusable strict row/section/action/block/day schemas and one strict 15-field root schema.
- `tieGroupCount` is optional and has `.min(1)`; zero is represented by absence.
- Actions are exactly `sys.chat` with `{ query }`.

## Final convergence

- Repo JSON Schema and Zod now use the same 15 fields and the same optional `tieGroupCount >= 1` rule.
- Adapter removes zero rather than emitting an invalid public value.
- Payload validator rejects unknown keys at every public nesting level.
- Audit understands nested Tencent Zod exports and the empty outer-template convention.
- View uses only components and props observed in the real export.
- Final import candidate retains the real name and ID; no identifier was invented.
- v8 adds only optional `section.kind`; all 15 root fields remain unchanged and v7 payloads fall back to the legacy variant renderer.
