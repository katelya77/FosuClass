# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context** — one `CONTEXT.md` at the repo root plus `docs/adr/` (which already exists with ADRs 0001–0005). Even though this is a multi-package repo (`apps/`, `packages/`, `miniprogram/`, `server/`, `cloudfunctions/`), the domain language is shared across them.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (created lazily by `/domain-modeling` when it doesn't exist yet)
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-keep-native-miniprogram.md
│   ├── 0002-vue3-admin-spa.md
│   └── ...
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0004 (release-pack-data-plane) — but worth reopening because…_
