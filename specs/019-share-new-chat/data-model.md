# Data Model: "New Chat", Full History and the Pinned Ranch Agent

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

No table, column or migration is added. The feature moves existing records
between existing states and adds in-memory state on the hub and in the two
browser stores.

## Stored

### Session file (agent storage)

| | Live | Closed |
|---|---|---|
| Path | `data/sessions/bridle:<clientId>.jsonl` | `data/sessions/bridle:<clientId>.<iso-ts>.archived.jsonl` |
| Written by | the agent runtime | the archive route, once |
| Read by | the agent (context), transcript route, chat index | chat index, history screens |

`<clientId>` is the conversation's identity (research F4): `admin`, a user id,
or `share-<visitorId>`. `<iso-ts>` is the closing time with `:` and `.`
replaced by `-`, as the route writes it today.

**Transition** — *live → closed*, by the archive route only:

```text
live file exists, non-empty ──copy──▶ closed file exists ──delete live──▶ no live file
live file missing or empty  ─────────────────────────────────────────▶ no live file, no closed file
```

A copy that succeeded followed by a delete that failed is undone by removing
the copy, so a retry does not produce two closed files for one conversation.

### `ChatSession` (Postgres, existing)

Fields this feature writes; all exist.

| Field | Live row | After `archiveSession` |
|-------|----------|------------------------|
| `sessionKey` | `bridle:<clientId>` | `bridle:<clientId>.<iso-ts>.archived` |
| `archived` | `false` | `true` |
| `id`, `externalUserId`, counts, `summary`, `insights`, `feedback` | — | unchanged |

- Unique on `(agentId, sessionKey)`: the timestamp makes each closed
  conversation's key distinct, so several per visitor coexist (FR-007).
- `externalUserId` stays `<clientId>`, which is what scopes "my history" to
  its owner — a closed conversation stays its owner's (FR-018) and nobody
  else's (FR-006).
- No row for the live key → nothing to move; reconciliation creates the closed
  row later from the file.
- The next conversation gets a new row under `bridle:<clientId>` from its
  first activity or the next reconcile.

**Validation**: `archiveSession` is called only after the closed file exists;
it never creates a row.

## In memory: the hub

Per conversation (`clientId` + `agentId`), on the existing `IClientChannel`:

| State | Set | Cleared | Used for |
|-------|-----|---------|----------|
| `awaitingSince` | a message is accepted for the agent | an event that ends a turn: a `message`, a `stream_end`, the terminal thinking event. Not `typing` and not a thinking step — those say the agent is working | D4 |
| `openStreams` (message ids) | `stream` | `stream_end` for that id | D4 |
| active thinking turn (existing `activeTurns`) | first `thinking` step | `thinking { done }` | D4 |
| `lastAgentEventAt` | every agent event | — | the 75 s silence bound |
| `buffer` (existing) | every routed frame | **emptied by a reset**, then holds the reset frame | replay |

`isTurnOpen` = (`awaitingSince` set or a non-empty `openStreams` or an active
thinking turn) and `now − lastAgentEventAt < TURN_SILENCE_MS`. When
`awaitingSince` is set and no agent event has arrived yet, the acceptance time
stands in for `lastAgentEventAt`.

`resetConversation` clears all of the above for the conversation, keeps `seq`
counting upward and keeps the sockets.

## In memory: the customer console (`bridle` store)

Keyed by conversation key, like everything in that store.

| State | Type | Meaning |
|-------|------|---------|
| `resetting` | `Record<string, boolean>` | a new chat is in flight — the single-flight latch (FR-013) |
| `agentOnline` | `Record<string, boolean>` | last `agent_status` for this conversation's agent; absent = not heard yet |
| `epochs` | `Record<string, number>` | bumped by every local reset; the composer is keyed on it |

**Derived** — `newChatBlock(key)`, first match wins:

| Order | Condition | Result |
|-------|-----------|--------|
| 1 | `resetting[key]` | `busy` |
| 2 | no messages in the conversation | `empty` |
| 3 | channel not `Connected`, or no `hubClientId` yet | `offline` |
| 4 | `agentOnline[key] !== true` | `agent_offline` |
| 5 | pending, an open thinking block, or a streaming bubble | `answering` |
| — | otherwise | `null` (available) |

**Local reset** (one function, two callers — the HTTP success and the
`conversation_reset` frame): today's `reset(conv)` — messages, pending, errors,
drafts, thinking, closed turns, staged files, watchdog, stored copy — plus
`epochs[key]++`. `lastHubSeqs` is kept.

### History (research D14–D16)

| State | Type | Meaning |
|-------|------|---------|
| `history[key].loaded` | `boolean` | the newest page was merged at least once this page session |
| `history[key].cursor` | `string \| null` | where the next older page starts, as the route returned it |
| `history[key].hasMore` | `boolean` | an older page exists |
| `history[key].loadingOlder` | `boolean` | single-flight latch for paging |
| `cached` on a message | `true`, session-only | the message came from the stored copy, not from this session's frames; stripped before persisting |

`IBridleMessage` itself is unchanged; a loaded message uses the fields a live
one uses (`id`, `role`, `text`, `ts`, `attachments`, `proposal`).

**Merge** — `mergeTranscript(local, page, now)`, pure:

```text
result = page.messages (file order)
       + local items the page does not hold yet (arrival order)
```

A local item is held back from the result when the page already has it or when
the rule in research D14 says it belongs to an older page or to a closed
conversation. Numbering (as built): the kept local tail keeps its `seq`, and
the page's messages are numbered just below it — `seq` may be zero or
negative, which the flow already allows for older pages. That differs from the
admin store, which renumbers from 1: here nothing that stays moves, so the
session's thinking blocks keep their place without the merge having to know
about them. The function also returns `cutSeq`, the highest `seq` the page
took over; a finished thinking block at or below it is dropped by the store.

A transcript message stands in for **one** message on screen (the admin rule
lets it stand in for every message with the same text), so the same words
sent twice with one of them saved keeps the other.

**Paging** — an older page is prepended and numbered below the current
minimum; nothing already on screen changes its `seq`.

**The stored copy** (`bridle:conversation:<key>` in `localStorage`): written
after every merge and every append, as today, capped at the newest 100
messages (two pages). Its role changes from "the conversation" to "the last
view, plus what the server does not have yet".

**Replayed frames** — agent content stamped at or before the loaded page's
newest message (`history[key].tailTs`) is already on screen as transcript and
is not appended again: the admin store's `_isTranscriptContent`, same reason.

**Reset and history**: the local reset sets `history[key]` to "loaded, empty,
nothing older" — the server's conversation is known to be empty — and bumps
the epoch; a history request that was in flight sees the epoch moved and
discards its answer.

## In memory: the customer console (`agent` store)

`IAgentData` gains one field the API already sends:

| Field | Type | Source | Used for |
|-------|------|--------|----------|
| `isAdmin` | `boolean` | `AgentDto.isAdmin`; `false` when absent | rail order and the admin mark |

Derived: `railOrder(agents)` — flagged agents first, everything else in the
order received (stable).

## In memory: the customer console (`chat` store)

| State | Type | Meaning |
|-------|------|---------|
| `sessions` | `IChatSession[]` | the history page's current list; replaced by each `listMine` |
| `showArchived` | `boolean` | which of the two lists is loaded |

`listMine(archived)` replaces `sessions` and returns nothing the page renders;
the page reads `sessions` (docs/state.md rules 1, 3, 4).

## In memory: the admin console (`bridle` store)

No new state. The `conversation_reset` frame empties the existing conversation
record with the same field resets `resetTranscript` performs.

## Vocabulary

| Spec term | In the code |
|-----------|-------------|
| Visitor | client id `share-<visitorId>` |
| Console user | client id `admin` (Owner/Admin, shared) or the user's `sub` |
| Current conversation | the live session file + the store's conversation record |
| Closed conversation | the `*.archived.jsonl` file + its `archived: true` row |
| Agent long-term memory | the runtime's `MEMORY.md` and daily logs — never touched |
| Conversation history | `GET /api/agent/{agentId}/transcript` over the live session file |
| Ranch admin agent | `Agent.isAdmin` |
