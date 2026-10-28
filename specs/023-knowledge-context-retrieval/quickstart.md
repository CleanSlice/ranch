# Quickstart: seeing the agent answer from the passages

**Feature**: [spec.md](spec.md) | **Contracts**: [lightrag-retrieve-context](contracts/lightrag-retrieve-context.md) · [query-knowledge-result](contracts/query-knowledge-result.md) · [console-query-refusal](contracts/console-query-refusal.md)

A validation guide. Each step names what it proves.

## Prerequisites

- `api` builds and its Prisma client is generated in this worktree
  (`cd api && npx prisma-import --force && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npx prisma generate`).
- For the manual steps: `mai-dev` (`dev-mazda-ai.mycoso.cloud`), built
  from the fork `mazda-ai-ranch` `dev` branch carrying this change
  (research D11, D13), with the 26MY Mazda3 Spec Deck indexed into a base
  bound to an agent. Fallback: the local stack (`cd api && docker compose
  up -d postgres-local lightrag` with the LightRAG image pinned to
  `v1.4.16` for the check, API on a side port, admin against it) with the
  deck uploaded into one base and indexed.
- Cluster access for the evidence gate and the logs: AWS profiles `mazda`
  (dev, cluster `mai-dev-use2-eks`) and `mazda-prod` (prod,
  `mai-prod-use2-eks`), region `us-east-2`; `aws eks update-kubeconfig`,
  then `kubectl -n ranch port-forward svc/lightrag 9621:9621` for LightRAG
  and `kubectl -n ranch logs deploy/ranch-api` for the per-lookup line
  (research D10). The LightRAG API key is the `lightrag-api` secret in
  namespace `ranch`; never print it.

## Gates

Run before any manual step; all must pass and the PR names them.

```bash
# api — run jest directly; `bun run test` regenerates Prisma and takes a running dev API down
cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/reins
cd api && bun run build                         # the api typecheck

# the console DTO changed: regenerate, never hand-edit
cd api && bun run generate:swagger
cd admin && bun run build:api
cd admin && npx nuxt typecheck                  # not `bun run dev`/`typecheck` scripts that regenerate
cd admin && bun test slices/reins               # if the slice has unit tests touched

# lint on the files touched (CRLF noise is the checkout, not the change)
cd api && npx eslint --rule 'prettier/prettier: ["error", {"endOfLine": "auto"}]' <changed files>
```

Expected: the new client, tool and detection cases pass (contracts list
them); the Mazda AFS regression case is among them and is named in the PR
(SC-005).

## Manual check — SC-001, SC-003

1. In the agent's chat ask: *For the Mazda3 hatchback what trim levels come
   with adaptive headlights?*
2. Expected answer: AFS standard on **2.5 S Premium** and **2.5 Turbo
   Premium Plus**, not on 2.5 S, Select Sport, Preferred, Carbon Edition; no
   "cannot guarantee" / "check the spec sheet"; the spec deck cited (the
   source chip in the chat).
3. Repeat five times in fresh conversations ("New chat"). All five agree.
4. From the API log, copy one lookup line (path used, chunks, kept/omitted,
   size, ms) and the tool result from the session's events for one run;
   confirm the result holds passage text with the trim table and no
   sentence of the refusal list. The shortened result goes into the PR
   (FR-014).

## The fixed question set (answer key)

Taken on 2026-10-28 from the dev base "Mazda"
(`knowledge-9938b6a8-5f36-4ee7-90de-df377cf51c73`): the 26MY Mazda3 Spec
Deck (`26my-mazda3-spec-deck-final-effective-06122026`, PDF + DOCX, sources
`source-f5e25faa…` / `source-8472d0ba…`) and the 26MY Mazda3 Product
Information Bulletin (`source-9815686c…` / `source-b0d50cde…`). The 25MY
deck is indexed in the same base, so every answer must name the 2026 model
year; the 25MY figure is listed where it differs — an answer giving it is
wrong, not "close".

The base (dev and prod alike) also holds two answer sheets,
`Genius_Test_Results_RAG` and `Genius_Correct_QA`, which contain the AFS
question with its answer and cover horsepower, fuel economy, AWD and
"what's new" for the Mazda3 (research F13/D14). Q1 is kept because it is
the production case; Q2–Q5 were chosen because **neither sheet contains
them** (checked 2026-10-28), so they can only be answered from the deck.

| # | Question (ask as written) | Correct answer | Where it is in the deck | Shape |
|---|---|---|---|---|
| Q1 | For the 2026 Mazda3 hatchback, what trim levels come with adaptive headlights? | Standard on **2.5 S Premium** and **2.5 Turbo Premium Plus**; not on 2.5 S, Select Sport, Preferred, Carbon Edition. (Sedan: Turbo Premium Plus only — Premium is hatchback-only.) Cited source may be the answer sheet or the deck. | Feature-availability table, "Headlights - adaptive Front-Lighting System (AFS)"; trim walk "2.5 S Premium (HB only) → Safety → Adaptive Front Lighting system"; also `Genius_Test_Results_RAG` Test 4 | table row (the regression) |
| Q2 | How much does the 2026 Mazda3 hatchback weigh? | 2.5L AT: **FWD 3,117 lb / AWD 3,274 lb / Turbo 3,417 lb**; 2.5L MT: **3,058 lb**. (Sedan AT: 3,111 / 3,283 / 3,413.) | Specifications → Chassis → Curb Weight; PIB "Curb Weight Changes" | table, sheet-free |
| Q3 | What is the fuel tank capacity of the 2026 Mazda3? | **FWD 13.2 gal / AWD 12.7 gal**, sedan and hatchback alike. | Specifications → Weights and Capacities | one row, sheet-free |
| Q4 | What is the minimum ground clearance of the 2026 Mazda3, sedan and hatchback? | **5.5 in** on both (unladen). The sheets explicitly lack it ("clearance figures still need to be added"). Height is *not* asked: the hatchback's 56.7 in appears in `Genius_Correct_QA`. | Specifications → Exterior Dimensions | one row, sheet-free |
| Q5 | Which 2026 Mazda3 hatchback trims offer the 6-speed manual transmission? | Only **2.5 S Premium**, FWD (SKYACTIV-MT; Premium drops AWD). | Trim walk "2.5 S Premium (HB only)"; feature table "SKYACTIV-MT 6-Speed Manual Transmission (FWD)" | table row, sheet-free |

| Q6 | What trims does the 2026 Mazda CX-30 come in, and which of them are turbo? | **Answer key to be filled during T003 from `26my-cx-30-spec-deck-final-effective-0612026` (DOCX / Product Summary CSV) in the dev base** — second production case (research F14): the agent answered that the base lacks 2026 CX-30 trim data. Check the sheets for CX-30 trim questions when filling it in. | 26MY CX-30 spec deck, trim walk / Product Summary | list (second regression) |

Spares (also absent from the sheets as far as checked): standard wheel
sizes by trim — 2.5 S 16-inch, Select Sport 18-inch black metallic,
Preferred 18-inch silver (sedan) / gray metallic (hatchback), Carbon
Edition 18-inch black metallic; the 26MY horsepower change 191 → 186 hp
(in the sheets for the sedan — use only as a spare).

Q1 is SC-001 (five runs). Q2–Q5 are the "3–4 table/list questions" of
SC-002 and the timing set of SC-004, and together the proof that the deck
path works without the answer sheets.

## Manual check — SC-002 (budget)

5. Ask Q2–Q5 from the answer key above.
6. For each, from the session events: the tool result parses as JSON and
   its text length is ≤ 12 000; when `truncated: true`, `omitted_passages`
   is present and the kept passages are whole.
7. Ask one question with two bases bound (any second base): the envelope
   is `{ results: [...] }`, each block ≤ 6 000, the whole ≤ 12 000 plus
   framing.

## Manual check — SC-004 (time)

8. **Before** switching the branch on: time the AFS question and two of the
   questions from step 5 (chat timestamp of the question → the first token
   of the answer; and the `query_knowledge` duration from the session
   events). Three runs each.
9. **After**: the same questions, three runs each. Record the lookup
   duration from the log line (research D10) as well.
10. Expected: the median does not rise; the lookup itself is well under
    `CONTEXT_TIMEOUT_MS` (30 s). If a lookup's p95 approaches 30 s, raise
    the constant in the PR with the measured number (FR-012). Both tables go
    into the PR.

## Manual check — US3 (guarantees kept)

11. A base with no indexed source, isolated: ask it by `knowledge_id` → the
    block says `no_relevant_content`; the log shows no LightRAG call for it.
12. Two bases bound, one instance scaled to zero: the result names the down
    base with the "most likely restarting" sentence and carries the other
    base's passages.
13. Isolation: the agent bound to base A asked about content only in base B
    → no passage from B (the automated SC-002 cases also cover this).

## Manual check — SC-006 (console)

14. Admin → the Mazda base → Query tab → an ordinary question: a written
    answer, as before.
15. A question the retrieval model declines (ask for an exhaustive list the
    deck does not hold, e.g. every dealer option code): the tab shows the
    partial-refusal copy, not the answer box and not "no content".

## What goes into the PR

- Endpoint and mode used, with the one-line reason (research D1, D2), and
  which path the staging deployment took (`query_data` or
  `only_need_context`, from the log).
- One shortened real tool result.
- The before/after time tables.
- The commands from Gates and their result.
- The twin-console statement: `reins` exists in `admin` only; `chat`
  (twin) unaffected because the `sources` shape is unchanged.
- The note that `reins/nestjs/` (separate repository) has the same defect.
