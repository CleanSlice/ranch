# Research: "New Chat", Full History and the Pinned Ranch Agent

**Feature**: [spec.md](spec.md) | **Date**: 2026-10-02 | **Ticket**: CLEAN-136

Everything below was read in the code on `origin/main` at `2c33daac` and
re-checked at `76f8b367` on 2026-10-02, after four commits landed (CLEAN-131,
132, 135, 137). Only CLEAN-137 touches these slices — it moved chat message
rendering into `Avatar` / `Bubble` components and one shared stylesheet per
console; the stores, the hub and the routes are unchanged and every line
reference below still holds. The agent
runtime lives in another repository (`CleanSlice/runtime`); it was read from a
local clone on `fix/CLEAN-124-context-budget` (2026-09-25) and may lag its
`main`.

## Findings

### F1. What the existing button does, end to end

`admin/slices/bridle/components/bridle/Provider.vue` (`onConfirmReset`, L513):
close the socket → `store.resetTranscript` → reconnect.

1. **Browser** — `admin/slices/bridle/stores/bridle.ts:1679` sends
   `DELETE /api/agent/:agentId/transcript?channel=…` and, on any `2xx`, empties
   the conversation record: messages, cursors, debug traces, thinking blocks,
   the outbox.
2. **API** — `BridleController.resetTranscript` (`bridle.controller.ts:698`)
   deletes `data/sessions/bridle:<channel>.jsonl` from storage and calls
   `hub.clearAgentSession`. A failed delete is logged and still answers `204`.
3. **Hub** — `BridleGateway.clearAgentSession` (`data/bridle.gateway.ts:527`)
   sends `session_clear { channel }` to the agent's socket; if the agent is not
   connected it logs at debug level and returns.
4. **Runtime** — `runtime.module.ts:204` maps `session_clear` to
   `session.clear("bridle", channel)`, which drops the in-memory session and
   unlinks the local session file. It does not cancel tasks running for that
   session, and it does not run the memory review that the agent's own `/clear`
   command runs first (`command.service.ts:91`).

Untouched by any of it: the agent's long-term memory (`MEMORY.md`, daily
logs), uploaded attachments, the chat index row in Postgres, the hub's replay
buffer for the conversation.

### F2. The non-destructive route exists and nothing calls it

`POST /api/agent/:agentId/transcript/archive` (`bridle.controller.ts:740`)
copies the live file to `bridle:<channel>.<iso-ts>.archived.jsonl`, deletes the
live file and calls `clearAgentSession`. It already accepts the share header
pair and already refuses a visitor naming someone else's channel
(`requireChannelAccess`, L269; specs at `bridle.controller.spec.ts:635`).
`archiveBridleTranscript` is in both generated SDKs; no gateway uses it.

Its gaps, measured against the spec:

| Gap | Consequence | Requirement |
|-----|-------------|-------------|
| Agent not connected → archives anyway, `session_clear` silently skipped | Agent returns with its local file and re-uploads it: old conversation is back **and** archived | FR-009, FR-010 |
| Nothing in storage → returns `{}` without telling the agent | Storage lags the agent's local file by its sync delay; a reset right after the first exchange clears the screen and leaves the agent's context intact | FR-004 |
| Reads storage as it is | The last exchange may not have been pushed yet; the closed conversation is incomplete | FR-007 |
| No check for a running turn | The answer in flight lands in the new conversation | FR-011 |
| Hub replay buffer kept | A tab that reconnects with an older `lastSeq` is replayed the old conversation's frames | FR-005 |
| Nobody else is told | Other tabs, other devices, colleagues on the shared conversation keep the old messages | FR-019 |
| Chat index not updated | See F5 | FR-007 |

### F3. The customer console keeps the conversation in the browser

`app/slices/bridle/stores/bridle.ts`: `hydrate` (L330) reads the conversation
from `localStorage`; the transcript on the server is consulted only to recover
replies a dead socket swallowed (`recoverFromTranscript`, L637). The admin
console is the opposite: it loads the transcript from the server on connect.

So a server-side reset alone changes nothing a console user sees. Today an
admin-console "New chat" on the shared `admin` conversation leaves every owner
and admin in the customer console looking at the deleted conversation
indefinitely.

The store already has the local half: `reset(conv)` (L1247) drops messages,
pending state, errors, drafts, thinking blocks, closed turns, staged files and
the stored copy, and deliberately keeps `lastHubSeqs` "so frames of the
conversation just cleared are not replayed into the new one". Nothing calls it.

### F4. Who a conversation belongs to

`clientIdFromJwtPayload` (`domain/chatIdentity.ts:93`): everyone with the Owner
or Admin role is the client `admin` and shares one conversation per agent, in
both consoles; any other signed-in user is their own `sub`; a visitor is
`share-<visitorId>`; an anonymous embed visitor is `anon-<id>`.

The hub tells a browser which one it is in `welcome.clientId`
(`bridleClientWs.handler.ts:309`); the app store keeps it in `hubClientIds`
(L267). That value is the transcript channel.

### F5. The chat index

`ChatSession` (`api/src/slices/chat/chat.prisma`) is an index over the session
files, unique on `(agentId, sessionKey)`, fed by live activity
(`recordActivity`) and by reconciliation (`ChatSyncService`). Reconciliation
gives an `*.archived.jsonl` file its own row with `archived: true`
(`parseName`, L209) and **never removes a row whose file is gone**.

After an archive that leaves the index alone: the live row stays, still showing
the old preview and counts, and opens to an empty transcript; the archived file
gets a second row at the next reconcile. One closed conversation, listed twice,
one of them hollow — and the ratings and summary stay on the hollow one.

Readers: the admin console lists every session with an "Archived" filter and
badge (`admin/slices/chat/components/chat/list/Provider.vue`). The customer
console lists the caller's own sessions (`GET /me/chats`, scoped by
`ownExternalId`), where `archived` is already a query parameter that defaults
to `false`; the app never sends it and shows no marker.

### F6. What the hub already knows

- `isAgentConnected(agentId)` — and it pushes `agent_status { connected }` to
  every browser socket on connect and on change. The admin store listens
  (`admin/slices/bridle/stores/bridle.ts:896`); the app gateway does not.
- `activeTurns` — per conversation, opened by the first `thinking` step,
  closed by the terminal `thinking { done }` (`trackTurn`, L469).
- `syncAgent(agentId, timeoutMs)` — asks the runtime to push its files to
  storage and resolves on its ack (`L580`); used by the file editor's "Sync".
- A numbered, buffered event stream per conversation (`route`, L128) delivered
  to every socket on it and replayed to a reconnecting one.

### F7. The app has no dialog primitive

`app` ships `Badge` and `Icon` only. The share panel confirms its destructive
actions inline, in a hand-rolled popover closed by Escape or an outside click
(`app/slices/share/components/share/panel/Provider.vue`).

### F8. Production, 2026-10-02: the server has the conversation, the console does not ask

Read-only, signed in to `api.ranch.cleanslice.org` with the platform account
(role Owner, so client `admin`), agent `agent-0db1552e-…` ("Rancher"):

- `GET /api/agent/:id/transcript?channel=admin` → 14 messages, 5 `user` and 9
  `assistant`, `hasMore: false`. The person's messages are there.
- `GET /me/chats/:id/messages` for the same session → the same 14.
- The customer console calls the transcript route from one place only,
  `recoverFromTranscript` (F3), and `missedReplies`
  (`app/slices/bridle/utils/transcriptTail.ts:65`) keeps agent messages only —
  and nothing at all unless the person's last question is already on screen.

So the missing messages are a property of the console, not of the data. The
console screen itself was not opened; this is the code plus the API's answers.

Side observation, not acted on: the chat index row for that session says 2
messages while the transcript holds 14.

### F9. How the admin console merges history with what is on screen

`loadTranscript` (`admin/slices/bridle/stores/bridle.ts:1733`): the newest page
(50 messages) is the base; local items stay below it only when the transcript
does not hold them yet —

- an agent message: still streaming, or stamped after the page's newest message
  (both stamps are the runtime's clock);
- the person's message: not delivered yet, or not found in the page and no
  older than the page's tail minus two minutes;
- "found in the page" is by id and, **interim**, by identical text within ±2
  minutes (`isInTranscript`, L664) — the runtime does not store the wire
  message id yet (its tasks T044).

Older pages are prepended on scroll and numbered below the current minimum so
nothing on screen moves (`loadOlderTranscript`, L1911). Attachment references
on replayed messages are turned back into chips (`_hydrateAttachments`).

The admin store keeps only an outbox of undelivered messages in the browser;
delivered ones are never persisted there. The customer console persists the
whole conversation (F3), which is the difference the merge has to account for.

### F10. The agent list

Admin: `useAgentRailEntries` sorts `isAdmin` first (stable), `RailItem` shows a
shield, and `/agents` lands on the admin agent. App: `IAgentData` has no
`isAdmin` (`app/slices/agent/domain/agent.types.ts`), the mapper drops the field
the API sends, the rail renders the API's order (`createdAt desc`), and landing
is "remembered → first running → first in list" by decision (spec 006, FR-020,
research R6). Nothing in spec 006 says the app rail should *not* pin; it was
never asked.

On production `GET /agents` returns 22 agents with Rancher last and
`isAdmin: true` only on it.

## Decisions

### D1. Two hosts, one component, one store action

**Decision**: "New chat" is offered by the share page and by the console's
agent chat page. Both draw their own header and already hide the chat's inner
one, so the control is a `bridle` component each host places in its header:
`<BridleChatNewChat :conversation="…">`. The rule for when it is available and
the reset itself live in the `bridle` store.

**Rationale**: `share` and `agent` reach the chat through `bridle`'s public
components today; a button owned by `bridle` keeps the conversation's behaviour
in the slice that owns the conversation (Principle I) and gives both hosts the
same behaviour by construction.

**Alternatives considered**: a button inside `BridleChatProvider`'s composer
row — rejected: both hosts hide the chat's header because they have their own,
and the composer has no room on a phone. A copy of the logic in each host —
rejected: that is how the two `buildShareUrl` came to exist.

**Not offered** on the landing page hero: for a signed-in person it is the same
conversation as on the agent page; for an anonymous demo visitor the identity
is a throwaway `anon-` channel.

### D2. Reuse the archive route; make it honest

**Decision**: no new endpoint. `POST /api/agent/:agentId/transcript/archive`
keeps its path, its access rule and its `{ archivedPath? }` answer, and gains
the order of operations in [contracts/archive-transcript.md](contracts/archive-transcript.md):
refuse if the agent is off the hub → refuse if a turn is open → ask the agent
to push → read → copy → delete → move the index row → reset the conversation on
the hub.

**Rationale**: the route was written for this ("the embed's New chat") and
already carries the share access rule and its tests. Every gap in F2 is a
missing step, not a wrong design.

**Alternatives considered**: `DELETE …/transcript` as the admin console uses —
rejected: destroys the record (FR-007) and lets an anonymous visitor erase the
audit trail. A new `POST …/new-chat` — rejected: a second route doing the same
thing with different rules is the twin problem inside one controller.

### D3. One hub operation for "this conversation was reset"

**Decision**: `IBridleGateway.resetConversation(agentId, clientId)` replaces
the two direct `clearAgentSession` calls. It drops the conversation's replay
buffer and turn state, sends `session_clear` to the agent, and routes one
numbered `conversation_reset` frame to every socket on the conversation — which
also makes it the only thing in the replay buffer. Both transcript routes call
it, so a reset from the admin console reaches the customer console too.

**Rationale**: FR-019, and F3 shows the admin button is already broken for
customer-console viewers. A frame in the numbered stream reaches open tabs
live and reconnecting ones by replay, with no new mechanism.

**Alternatives considered**: have the initiating browser clear only itself —
rejected: FR-019 and the shared `admin` conversation. Compare against the
transcript on every connect — rejected: storage lags the agent's file, so a
fresh conversation would look "reset" and be wiped.

**What the frame cannot reach**: a device offline for longer than the replay
window (10 minutes, `REPLAY_MAX_AGE_MS`). That device is covered by D14 — on
its next open it loads the conversation from the server and its saved copy of
the closed one is dropped.

### D4. "A turn is open" is a rule the hub applies

**Decision**: the hub answers `isTurnOpen(agentId, clientId)`. A turn is open
when any of these holds and the conversation's last agent event is younger
than `TURN_SILENCE_MS`:

- a message was accepted for the agent and nothing that ends a turn has come
  back yet (a `message`, a `stream_end`, the terminal thinking event — `typing`
  and thinking steps mean "working", not "done");
- a `stream` is open (no `stream_end` for its message);
- a thinking turn is open (`activeTurns`).

`TURN_SILENCE_MS = 75_000` — the silence after which the customer console
already declares a turn dead and tells the person so (`THINKING_STALE_MS`,
`app/slices/bridle/stores/bridle.ts:83`). One number, one meaning: after 75
seconds without a sign of life, neither side waits any longer.

The route refuses with `409 TURN_IN_PROGRESS`; the button is disabled on the
same signal the browser already has (`isPending`, an open thinking block, a
streaming bubble). The server is the authority; the browser's copy only saves
a round trip.

**Rationale**: FR-011 as a rule, not a hope (Principle VII). The hub sees every
event of the conversation regardless of which tab asked.

**Alternatives considered**: let the reset through and drop late frames in the
browser — rejected: `message` and `stream` frames carry no turn id, so a late
frame is indistinguishable from the first answer of the new conversation.
Allow the reset and cancel the turn — that is D13, and it lives in the runtime.

### D5. Flush before closing

**Decision**: before reading the live file, the route calls
`hub.syncAgent(agentId, ARCHIVE_SYNC_TIMEOUT_MS)`. If the agent does not ack in
time the route answers `503 SYNC_FAILED` and changes nothing.

`ARCHIVE_SYNC_TIMEOUT_MS = 5_000`. The default for this call is 15 s, sized for
an operator pressing "Sync" in the file editor and willing to wait. Here a
person is watching a button; past five seconds they assume it broke, and an
honest "could not start a new chat" (FR-010) is better than a ten-second
spinner. SC-001's two seconds is the target for the normal case and is
**measured** in quickstart step 9; if the measured push time makes 5 s too
tight or 2 s unrealistic, the number changes with the measurement written next
to it.

**Rationale**: FR-007 "complete", and the "last exchange" edge case. With no
turn open (D4) the file is quiescent, so one push captures everything.

**Alternatives considered**: archive what storage has — rejected: silently
loses the last exchange. Have the runtime do the archive — rejected: moves the
feature into another repository for no gain.

### D6. Nothing to archive is still a reset

**Decision**: when, after the push, there is no live file or it is empty, the
route skips the copy and still calls `resetConversation`. It answers `{}`.

**Rationale**: the "nothing stored yet" edge case — no empty closed
conversation, but the agent must still forget.

### D7. The index row moves with the conversation

**Decision**: `IChatGateway.archiveSession(agentId, sessionKey, archivedSessionKey)`
renames the live row to the archived key and sets `archived: true`; a no-op
when there is no row. The route calls it after the copy succeeded. No schema
change: `sessionKey` and `archived` exist.

**Rationale**: F5. The row *is* the conversation's record — its ratings,
summary, counts and id. Moving it keeps them on the conversation they describe
(FR-007, US4 scenario 4), leaves no hollow duplicate, and makes the closed
conversation appear in history at once instead of at the next reconcile. The
next reconcile finds the archived file under the row's new key and refreshes
it; the new conversation gets a fresh row from its first activity.

**Alternatives considered**: delete the live row and wait for reconcile —
rejected: loses ratings and summary. Teach reconcile to delete rows whose file
vanished — rejected for this feature: a failed listing would then delete rows,
and it is a behaviour change for every channel, not just this one.

`BridleModule` already imports `ChatModule` and `IChatGateway` is exported, so
this is the chat slice's public surface, not a reach into its internals.

### D8. Console history shows closed conversations

**Decision**: the console's history page gets a two-state filter, "Current" /
"Earlier", and the card of a closed conversation gets a marker. "Earlier" calls
the existing `GET /me/chats?archived=true`. The chat store gains the session
collection and the page renders from it.

**Rationale**: FR-018; without it a console user's "New chat" is a delete from
where they sit. The API needs nothing. The page today renders
`useAsyncData`'s `data`, which `docs/state.md` rule 4 forbids; a second list
state on top of that would copy the debt, so the lines being touched are moved
onto the store (Principle IV).

**Alternatives considered**: one mixed list — rejected: the API's `archived`
filter is exclusive and making it tri-state changes a contract the admin list
shares. Leave history for a follow-up — rejected: the story is not "New chat"
without it.

### D9. The browser side: one way to become empty

**Decision**: in the app `bridle` store —

- `startNewChat(conv)`: single-flight per conversation (`resetting[key]`);
  calls the service; on success applies the local reset; on failure leaves the
  conversation as it is and sets a keyed notice in `errors[key]`.
- `onReset(conv, seq)`: the `conversation_reset` frame, gated by `acceptSeq`
  like every other frame; applies the same local reset.
- The local reset is today's `reset(conv)`, plus bumping a per-conversation
  `epoch` the composer is keyed on, so typed text and staged files go with it
  (FR-003, FR-012).
- `agentOnline[key]` from the `agent_status` frame the hub already sends.
- `newChatBlock(key)`: `null` when the action is available, otherwise the
  reason — `empty`, `offline`, `agent_offline`, `answering`, `busy` — from a
  pure function in `utils/newChat.ts`.

The admin `bridle` store listens for `conversation_reset` and empties its
conversation record the same way its own reset does.

**Rationale**: `docs/state.md` — one conversation record per key, written by
the socket, rendered by key. The initiating tab and every other tab reach
"empty" through the same function, so they cannot disagree. A reason rather
than a boolean is what lets the page say why (FR-009).

### D10. Confirmation without a dialog primitive

**Decision**: the button opens a small inline confirmation in the same idiom as
the share panel (F7): the sentence, a confirm button, a cancel button; Escape
and an outside click cancel. Which sentence is chosen by whether the
conversation is a share conversation, and travels as a key.

**Alternatives considered**: add a dialog primitive to `app` — rejected: a UI
kit decision that does not belong in this feature.

### D11. Copy

**Decision**: keys under `chat.*` in `app/slices/bridle/i18n/locales/en.json`
for the button, the two confirmations, the reasons and the failure notices;
keys under `history.*` / `session.*` in `app/slices/chat/i18n/locales/en.json`
for the filter and the marker. `bun run i18n:sync` generates `ru`. Refusal
codes from the API are mapped to keys by a lookup; an unknown code falls back
to the generic failure key. The admin console gains no text.

The list is in [contracts/new-chat-ui.md](contracts/new-chat-ui.md).

### D12. Access is not widened, and one debt is named

**Decision**: the route keeps `requireChannelAccess` exactly as it is. A share
channel answers only to a console bearer or to that visitor's own header pair.

**Debt, not fixed here**: non-share channels on the three transcript routes
are caller-named and unauthenticated (`bridle.controller.ts:266`; the comment
there says the hardening is "tracked separately (research.md R8)"). The
anonymous embed depends on that
for its `anon-` channels, and its client is in another repository. This
feature adds no new exposure — the route is already reachable — but it is the
first screen to depend on it, so a follow-up ticket is owed: require a bearer
for any channel that is neither `share-` nor `anon-`.

### D13. Companion change in the runtime

**Decision**: a separate PR in `CleanSlice/runtime`, same ticket: on
`session_clear`, cancel the session's running tasks (`tasks.cancelAll`, already
used by the stop command) before clearing the session.

**Rationale**: D4 covers every turn the hub can see as open. It cannot cover a
turn that was silent for longer than 75 seconds and then speaks. Cancelling at
the source closes that, and SC-007's "zero cases" is fully met only with it.
The ranch side is correct and shippable without it; the gap is stated in the
PR rather than left implicit.

**Not changed**: the runtime does not run its memory review on a hub-initiated
clear. Whether an agent should learn from an anonymous visitor's conversation
is the long-term-memory question the spec leaves out of scope.

### D14. The server's transcript is the conversation; the browser's copy is what it lacks

**Decision**: the app `bridle` store loads the newest transcript page whenever
a conversation's channel says `welcome` for the first time in a page session,
and merges it with what is on screen by one pure function,
`mergeTranscript(local, page, now)` in `app/slices/bridle/utils/transcriptMerge.ts`.
The rule is the admin console's (F9), plus one clause for the copy the app
keeps in `localStorage`:

| Local item | Kept below the transcript when |
|------------|-------------------------------|
| the person's message, not delivered (sending / slow / failed) | always — it is the outbox |
| a bubble still streaming, an open thinking block | always |
| an agent message | stamped after the page's newest message |
| the person's delivered message | not found in the page (id, or interim: same text within ±2 min) and no older than the page's tail minus 2 min |
| **any of the last two that came from the stored copy** | **and** younger than `UNSAVED_KEEP_MS` |

`UNSAVED_KEEP_MS = 600_000` — the hub's replay window (`REPLAY_MAX_AGE_MS`).
The reasoning that makes it a rule and not a guess: an item the transcript
lacks is either too fresh to have been saved, or belongs to a conversation
that was reset. Within the replay window the hub settles which — a reset
arrives as `conversation_reset` (D3). Beyond it the hub can no longer tell, a
"too fresh to be saved" item cannot be that old, so it is the closed
conversation's and goes. This is what covers the device that was switched off
(FR-025).

A failed load keeps everything on screen and is retried at the next `welcome`
(FR-024). The merged list is written back to the stored copy, which from here
on is a cache of the last view plus the outbox — fast first paint, never the
authority. The share page gets the same behaviour for free: it is the same
store, and the route already accepts the visitor's header pair. The one
conversation left alone is the anonymous demo chat on the landing page: the hub
mints a new `anon-` channel on every connection (the app sends no stable id),
so there is no history to load and applying the merge would only empty a
stored copy that works today.

**Rationale**: FR-020, FR-022, FR-025. One function, pure, with the admin
rule's cases as its tests, is the only way the two consoles keep agreeing on
"is this message already in the transcript" — the rule exists twice today
because the stores are different, and Principle II says look at both.

**Alternatives considered**: stop persisting the conversation in the app, as
admin does — rejected: first paint would wait for the network on every open,
and the stored copy is what makes an undelivered message survive a reload.
Replace the stored copy with the transcript wholesale — rejected: drops the
outbox and the exchange in progress (the bug admin fixed as its research F3).
Fold `recoverFromTranscript` into the merge — not here: it answers a narrower
question ("what did the agent say to my last message") with its own tested
rule, the admin console keeps the same two paths, and merging them is a
change to turn recovery nobody asked for.

**The interim text match is inherited, knowingly.** Two identical messages
within two minutes can be mistaken for one. It is the same compromise the
admin console runs on, removed in both when the runtime stores wire ids.

### D15. Earlier messages, a page at a time

**Decision**: `loadOlder(conv)` fetches the next page by the cursor the route
returns and prepends it, numbered below the current minimum; the chat calls it
when the scroll reaches the top and restores the reading position by the height
it added. The gateway's `transcriptTail` becomes `transcriptPage`, returning
`{ messages, nextCursor, hasMore }` instead of dropping the last two.

Page size stays the route's default of 50, the admin console's
`TRANSCRIPT_PAGE_SIZE`.

### D16. Attachments in loaded history

**Decision**: the mapper carries a transcript message's attachment references
into `IBridleMessage.attachments`, with the same guarded download url the live
echo builds (`onUserMessage`). The message component already renders that
shape and already fetches the bytes with the conversation's credentials.

### D17. Pin the Ranch admin agent in the app rail

**Decision**: `IAgentData` in `app` gains `isAdmin`; the mapper reads it; a
pure `railOrder(agents)` puts flagged agents first with a stable sort; the rail
item shows the shield with a keyed label. Search filters the pinned agent like
any other. `resolveLanding` is not touched.

**Rationale**: FR-026. The admin console does the same three lines
(`useAgentRailEntries.ts:98`); the app copy is its twin and is written to the
same rule — flagged first, relative order otherwise unchanged.

**Not decided here**: whether a user without the Owner or Admin role should
see the Ranch admin agent at all. `GET /agents` returns every agent to every
signed-in user today; the pin follows the list it is given.

## Left out of scope, on purpose

| Item | Why | Follow-up |
|------|-----|-----------|
| Admin console button: deletes instead of archiving, outdated warning, no mid-answer guard, failed delete reported as success | Spec assumption; the admin console is not redesigned here | Ticket to switch it to this route and reuse D4's refusal |
| Transcript routes unauthenticated for non-share channels | D12 | Ticket |
| Attachments of a closed conversation stay in storage | Spec assumption | — |
| Reconcile never removes rows whose file is gone | D7 alternative | Ticket, if the admin `DELETE` keeps existing |
| The interim text match for "already in the transcript" | D14 — inherited from admin; needs the runtime to store wire ids | Runtime T044 |
| Who may see the Ranch admin agent in the customer console | D17 | Product decision, then a ticket |
| The chat index count that trails the transcript (F8) | Not part of what a person reported | Ticket if it matters to history |
| Landing on the admin agent in the customer console | Spec 006 FR-020 decided otherwise | — |
