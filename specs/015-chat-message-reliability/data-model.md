# Data Model: Chat message reliability

No database entity changes. Everything below is client-side view state, browser storage,
or in-memory hub state. Names are the intended TypeScript shapes; the app uses the
`IBridle*` naming of `app/slices/bridle/domain/bridle.types.ts`, the admin mirrors them
in its store file.

## Message (client)

Extends today's `IBridleMessage` / `IBridleMessageData`. New fields are optional so that
conversations already stored in `localStorage` still load.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Person's message: the `clientMessageId` (UUID) generated at send. Agent message: the wire `messageId`. Replayed message: the transcript event id. One id per message end to end (research F7). |
| `role` | user \| agent | unchanged |
| `text`, `attachments` / `parts` | — | unchanged |
| `ts` | number (epoch ms) | **Display only.** Local send time until the ack returns the hub's `ts`, then that value. Never used for ordering. |
| `seq` | number | Per-conversation arrival sequence, assigned by the store on append. The only ordering key. |
| `delivery` | `sending` \| `slow` \| `delivered` \| `failed` | Person's messages only. Absent means delivered (legacy and replayed messages). |
| `failureCode` | string? | `AGENT_OFFLINE`, `TIMEOUT`, `ATTACHMENT_FAILED`, `SHARE_REJECTED`, `OFFLINE`. Drives the wording under the bubble. |
| `streaming` | boolean? | unchanged; never persisted |

**Validation**: `seq` is strictly increasing within a conversation. A message with
`delivery` other than `delivered` always has `role = user`.

**Migration of stored conversations (app)**: on hydrate, messages without `seq` are
numbered in stored array order; messages without `delivery` are treated as delivered.

## Delivery state machine

```text
            send()                 5 s without ack            30 s without ack
  (none) ──────────► sending ───────────────────► slow ─────────────────────► failed
                        │                          │                            │ ▲
                        │ ack accepted             │ ack accepted               │ │ resend()  (same id)
                        ▼                          ▼                            ▼ │
                    delivered ◄────────────────────┘                         sending
                        ▲
                        │ ack rejected / message_error ──► failed (with failureCode)
```

- A page load turns every persisted `sending` / `slow` into `failed` (`TIMEOUT`): the
  ack can no longer arrive on a socket that no longer exists.
- `discard()` removes a `failed` message from the conversation and the outbox.
- Thresholds (`SLOW_MS = 5000`, `FAILED_MS = 30000`) live in `utils/delivery.ts`.

## Thinking block (client)

Unchanged except: gains `seq` (assigned when the segment opens) and is ordered by it.
The `ts` anchor workaround `Math.max(e.ts, lastTs + 1)` is removed.

## Flow item (view)

What the template iterates: `{ key, seq, kind: 'message' | 'block' | 'day', … }`,
produced by the pure `buildChatFlow(messages, blocks, locale)` in `utils/chatFlow.ts`,
sorted by `seq`. A `day` separator is inserted where the calendar day of `ts` changes
between two consecutive messages (it takes the `seq` of the message it precedes).

## Outbox (browser storage)

- **App**: no separate structure — the persisted conversation
  (`bridle:conversation:<key>`) already holds the person's messages; `delivery` and
  `failureCode` ride along.
- **Admin**: `localStorage["bridle:outbox:<agentId>:<channel>"]` = array of person's
  messages whose `delivery !== 'delivered'`, without image bytes (attachment references
  only). Merged under the loaded transcript; an entry is dropped once its id is present
  in the transcript (interim fallback: same text within ±2 min — research D3).

## Conversation (admin store)

The admin store's single `messages` / `thinkingBlocks` / socket become a record keyed by
conversation (`<agentId>:<channel>`), mirroring the app store:

| State | Scope |
|-------|-------|
| `messages`, `thinkingBlocks`, `closedTurns`, `nextSeq`, `lastHubSeq` | per conversation |
| `isTyping`, `isConnected`, `isAgentConnected`, transcript cursor | per conversation |
| socket | per conversation |
| `markdownEnabled`, panel open/closed | global (unchanged) |

## Channel ownership (app store)

`channels: Map<key, { channel, holders: number, closeTimer? }>`. `acquire(conv)`
increments (and cancels a pending close); `release(conv)` decrements and, at zero,
schedules the close after a short grace delay so a route change reuses the socket.

## Hub state (API, in memory)

| Structure | Key | Contents | Bounds |
|-----------|-----|----------|--------|
| `outSeq` | clientKey (`clientId:agentId`) | last sequence number issued | — |
| `replay` | clientKey | ring buffer of `{ seq, event }` routed to that client, kept whether or not a socket is registered | 500 events **or** 10 min, evicted with the client's other state after 10 min idle |
| `seenMessageIds` | clientKey | `clientMessageId → acceptedAt` | 10 min TTL, max 200 per client |

Registering a client no longer resets these; unregistering keeps them for the idle
window so a reconnect can catch up.

## Transcript message (API read model)

`TranscriptMessage` is unchanged in shape. Behavioural changes: equal `ts` values keep
file (append) order; one `assistant` event per emitted message is the expected runtime
format going forward (research D6). Older single-event turns keep rendering as one
bubble.
