# Quickstart: validating Sources in Chat Answers end to end

**Feature**: [spec.md](./spec.md) · **Contracts**: [contracts/](./contracts/) · **Data**: [data-model.md](./data-model.md)

What to run and what to see. Each block names the spec items it proves.

## Prerequisites

- Ranch on `feat/CLEAN-138-chat-sources`, local DB up (`cd api && bun run dev`
  runs docker + migrate), both consoles running.
- Runtime on its `feat/CLEAN-138-chat-sources` branch, one agent connected to
  the local hub with a knowledge base bound (two bases for the multi-base
  check) and `web_search` configured.
- A knowledge base **K1** with two indexed documents whose content only they
  answer; a second base **K2** with one.

## 0. Gates (run before and after)

```bash
# ranch
cd api && bun run build && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/bridle src/slices/chat src/slices/reins
cd admin && bun run build:api && npx nuxt typecheck && bun test slices
cd app   && bun run build:api && npx nuxt typecheck && bun test slices
bun test scripts            # chat-md.css twin
bun run locale:check        # app i18n complete, admin English
# runtime
bun test && bunx tsc --noEmit -p tsconfig.json
```

Expected: green, apart from the known runtime baseline noise in
`bridleAttachments.spec.ts` (pre-existing).

## 1. Citations appear and survive reload — Story 1, FR-001…010

1. Open the app console chat with the agent; ask a question only K1 answers.
2. **See**: chips after sentences, a numbered list under the bubble, "Hide
   sources" control. Every chip number has a list entry. (FR-001/002/008)
3. Ask the same question twice in one message so the model cites one document
   twice → one list entry, two chips with the same number. (FR-004)
4. Say "thanks" → no chips, no list, no control. (FR-009, SC-004)
5. Reload the page → identical chips and list. Open the same conversation in
   the admin console's chat history → the same. (FR-010, SC-007)
6. While an answer streams, watch for raw `[^1]`: there must be none — chips
   appear neutral, then numbered when the `sources` frame lands. (FR-007)

DB check: `select message_id, n, kind, name from "ChatMessageSource" order by created_at desc limit 10;`
→ rows for the bubble, dense `n` from 1.

## 2. Two kinds, opening — Story 2, FR-011…017

1. Ask something that needs K1 **and** the web ("…and what does the vendor's
   site say today?").
2. **See**: one numbering, internal and external entries visibly different;
   external opens in a new tab; internal shows name and — K1 still `closed` —
   is not a link. (FR-012/014/016)
3. `curl -H "Authorization: Bearer <app jwt>" <api>/api/agent/<agentId>/message/<messageId>/source/1/content -i`
   → `403 READER_ACCESS_CLOSED`. With another user's JWT → `404`. (FR-016b)
4. Ask a question both K1 and K2 answer → entries carry the base name. (FR-013)
5. Delete one cited source in the admin knowledge console; reload the chat →
   entry still named, not openable, not ratable. (FR-017)

## 3. Hide / show — Story 3, FR-018…020

Toggle on one message: list hides, chips stay, label flips; another message is
unaffected; click a chip on a hidden list → list opens and the entry is
highlighted. Tab to the control and press Enter → works.

## 4. Rating — Story 4, FR-021…028

1. Internal entry shows like/dislike; external shows neither. (FR-021)
2. Like → immediate; like again → withdrawn; dislike → flipped. Reload →
   state kept. (FR-022/024)
3. Kill the API, click like → control reverts and a notice appears. (FR-023)
4. On the share page (visitor) rate the same source → stored under
   `share-<visitorId>`; the console user's rating is untouched. (FR-025)
5. No bookmark control anywhere. (FR-028)

DB: `select author_id, rating from "SourceRating" where message_id = '<id>';`

## 5. Viewing policy — Story 5, FR-016a…d

1. Admin → Knowledge K1 → Overview → "Readers may open cited documents": off
   by default. Turn on, Save.
2. App chat: the K1 entry is now a link; it opens inline (PDF) or downloads
   (docx). The curl from §2.3 now returns the bytes. An **uncited** source of
   K1 by any route → 404. (FR-016b, SC-011)
3. Turn the policy off → the already-open chat shows the entry without a link
   after reload; the curl returns 403 again. (FR-016c)
4. Rancher chat: "Let readers open documents of K1" → the tool asks to
   confirm; without `confirm` nothing changes; with it, `readerAccess: open`.
   "Show K1" lists `readerAccess`. (FR-016d)

## 6. Statistics — Story 6, FR-029…033

1. Admin → K1 → Sources: columns *Cited*, *Likes*, *Dislikes*; a never-cited
   source shows `0`. Sort by each column. (FR-029/030)
2. Withdraw a rating in the chat → the count drops by one on refresh. (FR-031)
3. Delete the conversation from Chats → counts unchanged. Delete the source →
   its row and counts are gone. (FR-032)
4. Rancher chat: "Which sources of K1 are rated worst?" → the same numbers,
   sorted by dislikes. (FR-033)

## 7. Boundaries — FR-034…037

- Open the same conversation in admin chat, app chat, share page: same chips,
  numbers, controls (minus admin-only policy). (FR-034, SC-009)
- Inspect a `sources` frame and the transcript JSON: no `sourceId`,
  `knowledgeId`, S3 URI or excerpt. (FR-035)
- Send the same question through Telegram (or `POST …/message/sync`): plain
  text, no `[^n]`. (FR-036)
- Switch the app to `ru`: "Скрыть источники", but the document name and the
  page title are untranslated. (FR-037)

## 8. Compatibility

- Old client bundle (no `sources` capability) against the new runtime: answers
  without markers or list.
- New client against an old runtime: unchanged behaviour, no errors in the
  console.
- New runtime against an old hub: the `sources` event is ignored; chat works.
