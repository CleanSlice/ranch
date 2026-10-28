# Contract: the console query flags a partial refusal

**Feature**: [spec.md](../spec.md) | **Decision**: research D9 | **Requirement**: FR-011, SC-006

The console's `POST /knowledges/:id/query` keeps returning the written
answer. The only change: a reply that is the retrieval model declining is
reported as such.

## API

`KnowledgeQueryResultDto.reason`: `'no_relevant_content' | 'partial_refusal'`
(was the first only). `answer` is `null` whenever `reason` is set.

Detection, in `knowledge.service.ts` beside `isNoRelevantContentAnswer`:

```ts
export function isPartialRefusal(answer: string): boolean
```

Matches, case-insensitively, anywhere in the text:

- `I do not have sufficient information`
- `do not have enough information`
- `do not have complete information` (production, CX-30 trims, 2026-10-28)
- `does not contain enough information`
- `not able to provide a complete`
- `insufficient information in the provided knowledge base`
- `sufficient information in the provided context` (production, CX-30
  pricing, 2026-10-28 — the model's wording when it names "the provided
  context")
- `don't have access to` / `do not have access to` (production, 2025
  CX-30: "I don't have access to the 2025 Mazda CX-30 specification
  document.", 2026-10-28)
- `does not provide a complete` (the ticket's root-cause note)

In code these are six regular expressions in `knowledge.service.ts`
(`PARTIAL_REFUSAL_MARKERS`), each with the sentence it was grown from.
- `No relevant context found for the query.` (the server's own
  empty-content literal at v1.4.16 and v1.5.6, research F4/F13)

Order in `query()`: the existing `isNoRelevantContentAnswer` first (keeps
`no_relevant_content`), then `isPartialRefusal` → `partial_refusal`. The
list grows from observed sentences only; the first production sentence is
case 1 of the spec.

Agent path: not applied — the agent never receives generated text.

## Admin (`admin/slices/reins`, no twin)

`components/knowledge/query/Provider.vue`: where `result.answer === null`
shows "This base has no content relevant to that question.", branch on
`result.reason`:

- `partial_refusal` → "The retrieval model could not answer from this base.
  The documents may still hold it — try the agent, which reads the passages
  directly, or a narrower question."
- otherwise → the existing copy.

`admin` is English-only; no i18n key. The `IQueryResult` type is the
regenerated SDK DTO; no hand-written type.

## Regeneration

`cd api && bun run build && bun run generate:swagger`, then
`cd admin && bun run build:api`. The app SDK does not carry this DTO; if
`cd app && bun run build:api` changes anything, it is older drift and is
reported in the PR as such.

## Tests

- `knowledge.isolation.spec.ts`, "no-relevant-content detection": add cases
  for each sentence above → `partial_refusal`; a real answer stays a real
  answer; the `[no-context]` answer stays `no_relevant_content`.
- Console path regression: `KnowledgeService.query` against a fake `/query`
  returning prose → `answer` is the prose, `reason` absent (the FR-011
  "unchanged" guarantee, asserted on the service since the controller is a
  pass-through).
