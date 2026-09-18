# Research: Chat message reliability (CLEAN-102)

**Date**: 2026-09-18 · **Method**: static reading of the chat code in `app/`, `admin/`
and `api/` on `origin/main` @ `71f8351`. Nothing here was reproduced in a running stack
yet. Each finding is marked **Confirmed in code** (the defect is visible in the source)
or **Hypothesis** (a plausible cause that needs a reproduction before it is trusted).

## How the chat works today

- One in-memory hub in the API (`api/src/slices/bridle/data/bridle.gateway.ts`) relays
  between browser sockets and the agent runtime's socket. It stores nothing.
- The **app console** keeps each conversation in `localStorage`
  (`bridle:conversation:<key>`, `app/slices/bridle/stores/bridle.ts`). A reload replays
  that, never the server transcript. The landing-page hero chat and the agent page mount
  the same `BridleChatProvider` with the same key (`agentId`).
- The **admin panel** keeps nothing locally. On mount it calls `clearMessages()`, loads
  the transcript over HTTP, then opens the socket
  (`admin/slices/bridle/components/bridle/Provider.vue:316-331`).
- The **transcript** is an append-only JSONL written by the agent runtime. The runtime's
  source is **not in this repository**; the API only reads the file
  (`api/src/slices/agent/file/domain/transcriptReader.service.ts`).

## Findings

### F1 — Wrong order: the timeline is sorted by timestamps from two different clocks — *Confirmed in code*

Both surfaces build the visible flow by sorting messages and thinking blocks by `ts`:
`app/slices/bridle/components/bridle/chat/Provider.vue:116` and
`admin/slices/bridle/components/bridle/Provider.vue:85`
(`items.sort((a, b) => a.ts - b.ts)`).

The person's message is stamped with the **browser** clock (`ts: Date.now()` in both
`sendMessage`s). Agent messages are stamped with the **agent's** clock
(`ts: reply.ts ?? Date.now()`). The code already knows this — the thinking-block anchor
carries the comment "wire ts is agent-clock" and compensates with
`Math.max(e.ts, lastTs + 1)` — but messages get no such treatment.

So whenever the browser clock runs ahead of the agent's by more than the agent's
response time, the reply sorts **above** the question. That is exactly "сначала пишу я,
а потом ответ агента, но моё сообщение опускается". It is intermittent because it
depends on clock skew and on how fast the first agent message arrives (a greeting or a
short acknowledgement arrives within milliseconds, a long answer does not).

It also explains order changing after a reload in the admin: live order uses mixed
clocks, replayed order uses only runtime timestamps.

### F2 — Sent messages are fire-and-forget; nothing confirms delivery — *Confirmed in code*

`socket.emit('message', …)` has no acknowledgement in either client
(`app/slices/bridle/data/bridle.gateway.ts:140`, `admin/…/stores/bridle.ts:777`). The
hub's `handleMessage` returns nothing. The local bubble is added before the emit and
looks identical whether or not anyone received it.

When the agent's socket is not connected, the hub does not reject the message: it sends
back a fake **agent** message, "Agent is not connected. Please try again later."
(`bridle.gateway.ts:190-207`), and drops the person's text. In the admin, a reload then
shows the transcript, which never contained that message — "сообщение проглатывалось
после перезагрузки". In the app the bubble survives in `localStorage` but is
indistinguishable from a delivered one.

### F3 — Admin: the transcript load replaces the message list — *Confirmed in code*

`loadTranscript` does `this.messages = page.messages.map(…)`
(`admin/…/stores/bridle.ts:1066`). Anything appended locally before it resolves is
wiped. The mount sequence awaits it before connecting, which protects the first mount,
but the store is a **singleton shared by every provider** (the comment at
`Provider.vue:314` says so): the Rancher panel and an agent's chat tab write into the
same `messages`, `thinkingBlocks` and socket. Opening one while the other is mid-turn
clears and replaces the other's list. *Hypothesis*: this is a source of vanished and
mixed-up messages in the admin; needs a reproduction with both chats open.

### F4 — Events sent while the browser is not registered are dropped — *Confirmed in code*

`handleAgentEvent` looks the client up and, if it is not registered at that instant,
discards the event (`bridle.gateway.ts:254-257`). There is no buffer and no replay. Both
clients, on `disconnect`, set typing/pending to false and close all turns. After the
socket reconnects nothing re-requests what was missed.

Consequence: a `stream_end` / `message` that lands during a reconnect gap never reaches
the browser. The agent's logs show the answer; the chat shows a frozen or vanished
thinking indicator until a reload — "зависает ответ, хотя в логах он уже отображается".
In the app a reload does not help either, because the app replays `localStorage`, which
never received the answer.

### F5 — Landing page → agent page handoff tears down the shared channel — *Hypothesis*

The hero chat and the agent page use the same conversation key. `connect()` is
idempotent per key (`if (channels.has(key)) return`), and each provider's watcher
registers `onCleanup(() => disconnect(conversation))`. The agent page has a top-level
`await useAsyncData`, so it resolves under Suspense: its provider can mount (and find
the channel already open, so it opens none) **before** the landing page unmounts and
closes that channel. The agent page is then left with no channel: "Reconnecting…"
forever, the in-flight answer is lost (F4), and the next send takes the offline path,
which hands the text back to the composer as a draft — sending it again produces the
second copy seen in screenshot 4.

This fits "задал вопрос на главной, перешёл в агента — сообщения нет / ответ не пришёл"
and the duplicate, but the mount/unmount order must be observed in a running app before
it is treated as the cause. The fix (reference-counted channel ownership) is correct
regardless of whether this is the only cause.

### F6 — Separate agent messages fuse into one bubble after reload — *Cause outside this repo; to verify*

Live, each agent message arrives as its own `message` / `stream_end` with its own
`messageId`, and renders as its own bubble. After a reload the admin shows what the
transcript holds. The reader emits one message per JSONL event and the admin maps them
one to one — nothing in this repository joins messages. The fused text has no separator
at all ("Проверю:Ха!", "о себе.Skyhunter"), which is what plain concatenation of text
blocks produces.

Working conclusion: **the runtime persists one `assistant` event per turn, with the
turn's text blocks concatenated**, while it emits them on the wire one by one. This must
be confirmed by reading a real session JSONL for one of the screenshot conversations
(first task). The app's own reload is not affected (it replays its local copy), but the
app's chat history pages (`/chats/:id`) read the same transcript and are.

### F7 — No stable message identity across live and replay — *Confirmed in code*

The local echo id is `u-<Date.now()>` (app) or a random UUID (admin). The hub mints a
different `messageId: randomUUID()` when forwarding to the agent
(`bridle.gateway.ts:235`). The transcript's user event has its own `id`. Three ids for
one message: a local copy can never be matched with its saved copy, which is the
precondition for both "show it once" (FR-009) and "keep the unsent one after reload".
Whether the runtime stores the hub's `messageId` as the event `id` is unknown — same
JSONL inspection as F6.

### F8 — Scrolling — *Confirmed in code*

- Admin follows new content only when the reader is within 80 px of the bottom
  (`Provider.vue:286-298`). Sending is treated like any other change, so sending while
  scrolled up leaves the view where it was. This is the behaviour the request calls out.
- App scrolls to the bottom on **every** change, including each streamed chunk
  (`chat/Provider.vue:144-156`), which pulls a reader back down while they are reading
  earlier messages.

### F9 — Timestamps exist in the data and are not rendered — *Confirmed in code*

Every message already has `ts` in both stores and in the transcript DTO. Neither
`Message.vue` displays it.

## Decisions

### D1 — Order by sequence, display by time

- **Decision**: The visible flow is ordered by a per-conversation **arrival sequence**
  (`seq`) assigned by the store when an item is appended: messages and thinking blocks
  alike. `ts` is kept for display only and never used for ordering. Replayed history is
  taken in transcript (file) order and numbered from there. A thinking block is anchored
  by `seq`, replacing the `Math.max(e.ts, lastTs + 1)` workaround.
- **Rationale**: Arrival order at the client *is* the order the person experienced, it is
  immune to clock skew, and it needs no server change. Removes F1 completely.
- **Alternatives considered**: (a) normalise agent timestamps by an estimated clock
  offset — fragile, still wrong for sub-second gaps; (b) have the hub stamp every event
  with its own clock and sort by that — still loses to the browser-stamped local echo
  unless the echo is re-stamped from the ack, and adds nothing `seq` does not give.
- **Display time**: a person's message shows its local send time until the hub's ack
  returns the server time, then shows that (so live and replay agree, FR-018).

### D2 — Acknowledged sends with a client-generated id

- **Decision**: The client generates `clientMessageId` (UUID) per message and sends it
  with the `message` event using a socket.io acknowledgement callback. The hub replies
  `{ status: 'accepted', messageId, ts }` once it has handed the message to a connected
  agent socket, or `{ status: 'rejected', code }` (`AGENT_OFFLINE`,
  `ATTACHMENT_FAILED`, `SHARE_REJECTED`). The hub forwards the **client's** id to the
  agent as `messageId` instead of minting its own.
- **Backward compatibility**: a client that passes no ack callback (embed widget, older
  bundles) keeps today's behaviour, including the "Agent is not connected" message. New
  clients get the rejection instead and never see that fake agent message.
- **Rationale**: Smallest change that gives a truthful delivery state (F2) and one id
  end to end (F7).
- **Limit, stated plainly**: "accepted" means *handed to the agent's socket*, not
  *written to the transcript*. The spec's definition of delivered is the latter. Closing
  that gap needs the runtime to acknowledge persistence — see D6 / Open items. Until
  then a message can in rare cases be "delivered" and still be missing after a reload
  (agent crash between receive and write). The plan treats hub acceptance as delivered
  and records this as a known gap rather than hiding it.
- **Alternatives considered**: HTTP `POST /send` for delivery + socket for replies — a
  bigger change to two clients and the embed contract, for the same guarantee.

### D3 — Delivery state machine and a per-device outbox

- **Decision**: States `sending → slow (5 s) → delivered | failed (30 s or rejected)`.
  Messages that are not `delivered` are persisted per device: the app already persists
  the conversation and gains a `delivery` field; the admin gains a small outbox in
  `localStorage` keyed by agent + channel, merged under the transcript on load. On
  reload, anything still `sending`/`slow` is shown as `failed` with Resend / Discard.
- **Resend** re-emits with the **same** `clientMessageId` (see D4). No automatic resend,
  per the spec.
- **De-duplication on load (admin)**: an outbox entry whose id appears in the transcript
  is dropped from the outbox. If the JSONL inspection shows the runtime does *not*
  persist the forwarded id, the interim rule is: drop an outbox entry when a transcript
  user message with identical text exists within ±2 minutes of its send time. That
  heuristic is a stop-gap and is called out as such in tasks.

### D4 — Idempotent receive in the hub

- **Decision**: The hub remembers recently seen `clientMessageId`s per client
  (in-memory, 10-minute TTL, bounded). A repeat is acknowledged
  `{ status: 'accepted', duplicate: true }` and **not** forwarded again.
- **Rationale**: Makes Resend safe when the original did arrive but its ack was lost
  (FR-005).

### D5 — Replay buffer for missed events, transcript as the safety net

- **Decision**: The hub stamps every event it routes to a browser client with a
  monotonically increasing per-client `seq` and keeps a bounded ring buffer of recent
  events per client (last 500 events or 10 minutes, whichever is smaller). It buffers
  even when the client is not currently registered. On (re)connect the client sends
  `lastSeq` in the handshake; the hub replays everything after it before live traffic.
  Clients stop force-closing turns on a transient disconnect; they close them only when
  the watchdog expires or the replay says the turn ended.
- **Safety net**: when the watchdog expires with a turn still open, the client fetches
  the transcript tail and reconciles (admin already has the route; the app gains a
  gateway method for the existing `GET /api/agent/:id/transcript`).
- **Rationale**: Fixes F4 for both surfaces and for the landing → agent handoff, without
  making the transcript a live data path.
- **Constraint**: the hub is in-memory, so this assumes a single API instance — the same
  assumption the hub's client and agent registries already make. Noted in the plan.
- **Alternatives considered**: transcript polling only — slow, and useless for the app's
  local-first history; persistent event store — out of proportion for this problem.

### D6 — Message boundaries in the transcript

- **Decision**: In this repository: the reader gains support for per-message assistant
  events (it already emits one bubble per event, so this is mostly tests and a
  tie-break on file order instead of `ts`). The **runtime** must persist one assistant
  event per emitted message, with the wire `messageId` as the event id, and persist the
  forwarded user `messageId` too. That change lives outside this repo and is tracked as
  a dependency.
- **Interim**: none that is honest. Text blocks concatenated without a separator cannot
  be split back reliably. Existing fused conversations stay fused (already an assumption
  in the spec).

### D7 — Channel ownership by reference count (app), conversation-scoped state (admin)

- **Decision (app)**: `connect`/`disconnect` become acquire/release with a reference
  count per conversation key; the socket closes when the last holder releases, after a
  short grace delay so a page-to-page handoff reuses the live socket. In-flight turn
  state survives the handoff.
- **Decision (admin)**: the singleton store's chat state becomes keyed by conversation
  (agent + channel), mirroring the app store, so the Rancher panel and an agent tab no
  longer share one message list and one socket.
- **Rationale**: F5 and F3. The admin change is the largest single piece of work here;
  it is also the precondition for the outbox and sequence numbers being per
  conversation.

### D8 — Scrolling

- **Decision**: One rule in both surfaces: *sending* always scrolls to the bottom;
  *incoming* content follows only a reader who is within 80 px of the bottom. The app's
  unconditional scroll-on-every-chunk is replaced by the admin's near-bottom rule; the
  admin gains the scroll-on-send.

### D9 — Timestamps

- **Decision**: Time of day under each message, a date separator between days, full
  date-time in the `title` tooltip. Formatting via `Intl.DateTimeFormat` with the active
  locale in the app (no new strings for the time itself); the admin uses `en`. New
  wording (delivery states, Resend, Discard, date separators "Today"/"Yesterday") goes
  through `docs/i18n.md`: keys in the slice's `en.json`, `bun run i18n:sync` for `ru`.

### D10 — Testing

- **Decision**: API changes are covered in the existing jest specs
  (`bridleClientWs.handler.spec.ts`, `bridle.gateway.spec.ts`,
  `transcriptReader.service.spec.ts`). `app/` and `admin/` have no test runner today
  (`"test": "echo 'no tests yet'"`), so the logic that matters — sequencing, the
  delivery state machine, outbox/transcript reconciliation, replay application — is
  written as pure functions under each slice's `utils/` and covered with `bun test`,
  which needs no new dependency (Bun is already the runtime). UI behaviour (scroll,
  labels) is validated through `quickstart.md`.

## Update 2026-09-18 — runtime source located

The runtime is the sibling repository `CleanSlice/runtime` (the API already looks for it
at `../runtime`, see `paddockRunner.resolveRuntimeRoot`). Read at `da3e74f`, not run:

- **F6 confirmed in source.** `src/slices/runtime/loop/domain/loop.service.ts`
  (`sendFinalResponse`) appends **one** `assistant` event per turn with
  `data: { text: fullText }` — the text accumulated over the whole turn — while the
  channel receives the pieces as separate messages. That is the fused bubble.
- **F7 answered.** That event's `id` is a fresh `randomUUID()`, not the wire
  `messageId`. Whether the `user` event keeps the forwarded `messageId` was not checked.
- Open items 1 and 2 below are therefore mostly closed: slice 6 is a change in
  `CleanSlice/runtime` (its own ticket/PR), and D3's interim text-match rule is needed
  until that lands.

## Update 2026-09-18 — experiments against the local stack

Stack: API :3333, app :3000, admin :3001, local `CleanSlice/runtime` connected to the hub
as `agent-bb620efe-…`. Method: a Node script using `socket.io-client`, logging in through
`POST /auth/login` and connecting to `/ws/client` exactly as the browser does. The UI
itself was not driven — ordering, scrolling, the landing handoff (F5) and the admin
singleton (F3) are still unobserved in a browser.

| # | Experiment | Result |
|---|-----------|--------|
| E1 | Send with a socket.io ack callback and a `clientMessageId` | Reply arrived in 1.2 s. **Ack callback never called** (waited 45 s). F2 reproduced. |
| E2 | Compare ids for one exchange | Wire agent `messageId` `38379ecb…`; transcript `assistant` event id `f421a550…`; transcript `user` event id `51a748fc…`, its `data` holds only `text, from` — no message id at all. **Three unrelated ids. F7 reproduced**, and the runtime does not persist the forwarded id. |
| E3 | Two connections of the same login; the **first** one sends | First connection received **nothing**. The second, which sent nothing, received `typing` and the answer. **New finding F10, reproduced.** |
| E4 | Send, drop the socket 100 ms after `typing`, reconnect 25 s later, wait 25 s | **No events after reconnect.** The runtime's transcript contains the full 306-character answer. **F4 reproduced.** |
| — | Clock skew on this machine | `ts` on agent events was within 1 ms of the local clock (same host), so F1 cannot show up locally without skewing the clock; it needs the browser scenario in quickstart. |

### F10 — One registration per identity: a second view steals the first one's events — *Reproduced (E3)*

The hub keeps exactly one socket per `clientId:agentId`
(`BridleGateway.clients`, `registerClient` overwrites). And
`clientIdFromJwtPayload` gives **every Owner and Admin the same `clientId`: `admin`**
("they share one channel so their history lives in one place",
`api/src/slices/bridle/domain/chatIdentity.ts:93`); other users get their `sub`.

So the last view to connect receives everything and every earlier view silently receives
nothing: a second tab, the admin panel next to the app console, a colleague who is also
an admin opening the same agent, or a page that reconnected. For the view that lost, the
turn looks exactly like the reports: the question is sent, the indicator spins, no answer
arrives although the agent's log has it; the *other* view shows an answer to a question
nobody asked there. This is very likely the most frequent cause of "зависает ответ" and
of messages turning up in the wrong place, and it makes F4 worse (any reconnect
elsewhere cuts this view off).

Shared history for admins is a product decision and stays. What has to change is the
delivery: fan out to **all** sockets registered for the identity.

### D11 — Several sockets per identity (decision)

- **Decision**: `clients` becomes `clientKey → Set<socket registration>`. Events for a
  client are sent to every registered socket. The sequence and replay buffer (D5) stay
  per `clientKey`; each socket reports its own `lastSeq`. `unregisterClient` removes one
  socket; turn tracking is cleared when the last one leaves.
- **Consequence for the person's own messages**: a message sent from view A is echoed by
  the hub to the identity's *other* sockets as a new `user_message` event
  (`{ messageId, text, attachments, ts, seq }`), so view B shows the question as well as
  the answer instead of an orphan answer. View A ignores it by id.
- **Rationale**: Required by FR-008 / FR-026; without it the ack and replay work would
  still leave multi-view use broken.

### F11 — Agent status disagrees between the list and the detail — *Confirmed in code*

In the admin's agents screen the list (`workspace/Rail.vue`) renders the array loaded
once by `useAsyncData('admin-agents', () => agentStore.fetchAll())` in
`workspace/Provider.vue:12`. It is refreshed only after a delete; nothing polls it (the
30-second timer there refreshes capacity only). The detail pane (`workspace/Main.vue`)
loads its own copy with `fetchById`, refreshes it through `useAgentLifecycle` and also
reads the live status stream (`useAgentStatusStore().agents[id]`). `fetchById` does not
write its result back into `agentStore.agents`. So the list keeps whatever status it saw
at load time — "Deploying" — while the detail moves on to "Failed".

### D12 — Single source of truth (SSOT) for agents (decision, revised on request)

*Direction from the request: "используй SSOT для таких проблем чтобы не возвращаться к
ним" — fix the class of defect, not the one screen.*

The defect is not "the list is not refreshed"; it is that **the same agent exists as
several independent copies**: the list array from `fetchAll`, a `useAsyncData` copy per
detail component from `fetchById` (`workspace/Main.vue`, `edit/Provider.vue`,
`agentFile/Provider.vue`; in the app `agent/Provider.vue`, `agent/chat/Provider.vue`),
the live copy in `agentStatusStore.agents`, and optimistic edits applied to a local ref
in `useAgentLifecycle`. Any of them can move on without the others.

- **Decision**: An agent lives **once**, in `agentStore.agents`. Rules, in both `admin/`
  and `app/`:
  1. Every read that returns an agent writes it into the store: `fetchAll` replaces the
     collection, `fetchById` / create / update / restart **upsert** by id.
  2. Components render from the store by id (`agentStore.byId(id)`), never from the
     value a fetch returned. `useAsyncData` is kept for SSR and `pending`/`error`, not
     as the render source.
  3. Pushes write into the same record: the status stream's `applyMessage` patches
     `agentStore` instead of holding a parallel `agents` map.
  4. Optimistic changes go through one store action (`patch(id, partial)`) with rollback,
     not through a component-local ref.
- **Result**: the list row, the header and the Overview card are the same object; they
  cannot disagree, and a future screen that shows an agent gets this for free.
- **Also to check**: `useAgentLifecycle` notes that the backend reconciles status on each
  `fetchById` ("Backend syncStatus runs on each fetchById"). If the list endpoint does
  not reconcile, a non-selected agent's row depends on the stream alone — verify, and
  make sure the stream covers every listed agent.
- **Written down so it sticks**: a short rule in `docs/` linked from `AGENTS.md`.
- **Alternatives considered**: polling `fetchAll`, or overlaying the stream on the list
  in the rail only — both patch this screen and leave the duplicated state that caused
  it.
- The chat work follows the same principle: one conversation record per key in the store
  (D7), one id per message (D2), one ordering key (D1).
- **Scope note**: this is unrelated to the chat code. It is included in this feature on
  request; it is a small, separate slice and could equally ship as its own PR.

### Local-environment note

On this Windows machine the runtime writes the session to `data/sessions/bridle:admin.jsonl`;
NTFS treats the colon as an alternate data stream, so the file appears as an empty
`bridle` with a stream `admin.jsonl`. The API's transcript route reads through the file
gateway and returned 0 messages locally. **Reload-from-transcript scenarios (US3, and the
admin's reload in general) cannot be validated on this local setup as it stands**; they
need the cluster or a non-Windows runtime.

## Open items

1. **Read a real session JSONL** for one of the screenshot conversations to confirm F6
   and answer F7 (does the runtime store the forwarded `messageId`?). Blocks the final
   shape of D3's de-duplication and D6.
2. **Where the agent runtime's source lives and who changes it** — needed for D6 and for
   a persistence-level delivery ack (D2's stated gap). Not discoverable from this repo.
3. **Reproduce F5 and F3** in a running stack before and after the fix; they are the two
   hypotheses in this document.
4. **API replica count in production** — D5 assumes one instance.
