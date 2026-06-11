# AI campus agent demo guide

The campus agent is a tool-grounded assistant for the competition direction
`2-E digital life: integrated service agent`.

## Stable demo scenarios

1. continuous self-study time and empty-room recommendation;
2. natural-language teacher/class/classroom/course query;
3. personalized weekly study plan;
4. meeting/conflict planning and decision assistance.

Demo mode responses are marked with:

```json
{
  "safety": { "demoData": true },
  "evidence": { "releaseVersion": "demo-data", "sources": ["demo-data"] }
}
```

Demo data must not be mixed into production release files.

## Tool-grounded policy

Deterministic campus tools provide facts: schedules, empty rooms, indexes,
calendar, current week, and data diagnosis. Domestic providers such as DeepSeek,
Coze, or existing configured providers may help with intent understanding and
language organization, but provider text must not override tool facts.

If the provider is unavailable, deterministic tools continue to work and the UI
shows that intelligent wording is temporarily unavailable.

## Personalization

Personal schedule context is local and opt-in. The mini program exposes helpers
to view remembered personalization, pause personalization, delete
personalization, and clear the conversation. Sensitive identity fields are
redacted before any provider request.

## Evidence card

Agent responses include lightweight `taskSteps` and `evidence`:

- understood requirement;
- read schedule;
- checked empty rooms;
- queried index;
- generated recommendation;
- term, release version, current teaching week, source modes, checked time.

No result should contain `[object Object]`, fabricated rooms, fabricated teacher
schedules, raw token/session values, or stale release data described as live.
