# Real Widget Export Compatibility Diff

Oracle: `C:\Users\Katelya\Downloads\小序-校园智序结果卡.widget`
SHA-256: `074d4b99d46f618e71ae08d4ac6718900a0cdd71c9d1944ba7ddb77a6c8a50d5`
Widget ID: `978b004b2f054e8bbd5438159c7329ff`

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
