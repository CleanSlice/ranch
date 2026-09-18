# Contract: browser ↔ hub socket protocol (additive changes)

Namespace and events as handled by
`api/src/slices/bridle/handlers/bridleClientWs.handler.ts`. **Every change is optional
and additive**: a client that sends none of the new fields and passes no ack callback —
the embed widget, an old cached bundle — gets exactly today's behaviour.

## Handshake `auth`

| Field | Type | Status | Meaning |
|-------|------|--------|---------|
| `token` / share fields / `capabilities` / `prompt` | — | unchanged | |
| `lastSeq` | number | **new, optional** | Highest hub `seq` this client has applied for this agent. When present, the hub replays buffered events with `seq > lastSeq`, in order, immediately after `welcome` and before any live event. Absent or `0`: no replay (first connect). |

## `welcome` (hub → browser)

`{ clientId }` → `{ clientId, seq }` where `seq` is the hub's current sequence for this
client. **New, optional to read.** A client whose `lastSeq` is greater than `seq` (the
hub restarted and lost its buffer) resets its `lastSeq` to `seq` and runs the transcript
reconcile instead of waiting for a replay.

## `message` (browser → hub)

```ts
{
  text?: string
  parts?: BridlePart[]
  images?: Array<{ base64: string; mediaType: string }>
  attachmentIds?: string[]
  clientMessageId?: string   // NEW, optional — UUID minted by the browser
}
```

**Acknowledgement (NEW, optional)** — when the browser passes a socket.io ack callback,
the hub calls it exactly once:

```ts
| { status: 'accepted'; messageId: string; ts: number; duplicate?: true }
| { status: 'rejected'; code: 'AGENT_OFFLINE' | 'ATTACHMENT_FAILED' | 'SHARE_REJECTED' | 'EMPTY'; message?: string }
```

Rules:

1. `accepted` is sent after the message has been handed to a connected agent socket.
   `messageId` equals `clientMessageId` when one was supplied, otherwise the id the hub
   minted. `ts` is the hub's clock at acceptance.
2. The hub forwards `clientMessageId` to the agent as the message's `messageId`
   (today: a hub-minted UUID).
3. **Idempotency**: a `clientMessageId` already accepted from the same client within the
   last 10 minutes is answered `accepted` with `duplicate: true` and is **not** forwarded
   again.
4. **Agent offline**: with an ack callback → `rejected / AGENT_OFFLINE`, and the
   synthetic "Agent is not connected. Please try again later." agent message is **not**
   sent. Without an ack callback → today's synthetic message, unchanged.
5. **Attachment failure**: with an ack callback → `rejected / ATTACHMENT_FAILED` *and*
   the existing `message_error` event (kept for the composer-level notice). Without →
   `message_error` only, unchanged.
6. **Share link rejected**: `rejected / SHARE_REJECTED`, then the existing
   `bridle_error` + disconnect, unchanged.
7. The browser treats a missing ack after 30 s as `failed / TIMEOUT`. A late ack for a
   message already marked failed moves it to delivered.

## Events hub → browser (`message`, `stream`, `stream_end`, `typing`, `thinking`, `debug`, `agent_status`, `message_error`)

Each payload gains **`seq: number`** (new; per client, strictly increasing, assigned by
the hub when it routes the event). Payloads are otherwise unchanged. Old clients ignore
it.

Browser rules:

- Remember the highest `seq` applied per conversation (`lastSeq`), in memory and, for
  the app, alongside the persisted conversation.
- Ignore an event whose `seq` is not greater than `lastSeq` (replay overlap is harmless).
- Applying a replayed `stream` / `stream_end` for a `messageId` already on screen updates
  that bubble; it never adds a second one (unchanged rule, now relied upon).

## Several sockets per identity (NEW behaviour)

Today the hub holds one socket per `clientId:agentId` and a new connection silently
replaces the previous one (every Owner/Admin has `clientId = "admin"`). New rule:

- Any number of sockets may be registered for one identity. Every hub → browser event for
  that identity is sent to **all** of them, with the same `seq`.
- Each socket reports its own `lastSeq` and gets its own replay.
- Disconnecting one socket does not affect the others; per-identity turn tracking is
  cleared when the last socket leaves.
- **`user_message` (hub → browser, NEW)**: when a socket's `message` is accepted, the hub
  sends `{ type: 'user_message', messageId, text, attachments?, ts, seq }` to the
  identity's **other** sockets, so a second view shows the question and not only the
  answer. Clients ignore a `user_message` whose `messageId` they already hold. Old
  clients ignore the unknown event.

## Buffering guarantees (hub)

- Events addressed to a client are buffered even while no socket is registered for it.
- Bounds: last 500 events or 10 minutes per client; whichever is hit first evicts the
  oldest. Buffer and sequence are dropped after 10 minutes without a registered socket.
- In-memory only: a hub restart loses buffers; clients detect it via `welcome.seq` and
  fall back to the transcript.

## HTTP

No new routes. `GET /api/agent/:agentId/transcript` (existing, used by the admin) is
additionally called by the app console for the watchdog safety net, through a new method
on the app's bridle gateway using the generated SDK. Response shape unchanged; equal
`ts` values are returned in file order.

## As implemented (2026-09-18) — where the code refines the text above

- **Who gets an ack.** The handler returns the ack from `handleMessage`; Nest passes it
  to the socket.io callback when there is one. "The caller renders the outcome itself"
  is keyed on **`clientMessageId` being present**, not on detecting a callback: a
  message with an id is acknowledged truthfully and never gets the synthetic "Agent is
  not connected" reply; a message without one (embed widget, old bundles) behaves as
  before.
- **Which events carry `seq`.** Everything routed to a conversation: `message`,
  `stream`, `stream_end`, `typing`, `thinking`, `user_message`, and API-originated
  steps sent through `sendToClient`. **Not** `agent_status`, `debug`, `welcome`,
  `message_error`, `bridle_error` — those are state or per-socket notices, sent
  unnumbered and never replayed. Clients must ignore the `seq` rule for events without
  one.
- **`seq` is seeded from the hub's clock** when a conversation is first seen, then
  incremented by one per event. After an API restart the new numbers are therefore
  still above any `lastSeq` a browser kept, and its catch-up returns the new buffer.
  `welcome.seq` lower than `lastSeq` can still happen (first connect to a hub that has
  never seen the conversation reports `0`); clients treat that as "nothing to replay".
- **Streamed frames are coalesced in the buffer**: a `stream` frame carries the whole
  text so far, so only the newest one per `messageId` is kept for replay.
- **`user_message`** is sent to the conversation's other sockets for every accepted
  message, including ones that arrived over HTTP (`sendAndAwait`), and is buffered like
  any other event; the sending socket recognises its own on replay by `messageId`.

## Agent ↔ hub — `CleanSlice/runtime` (branch `fix/CLEAN-102-transcript-per-message`)

The model-facing history must not change shape (four LLM providers build prompts from
it), so the turn is still **one** `assistant` event whose `data.text` is the whole turn.
What changed:

- The `assistant` event gains display-only **`data.messages: [{ id, text, ts }]`** — the
  bubbles the turn was streamed as, `id` being the wire `messageId`. The API's transcript
  reader replays those instead of `data.text`; an event without them, or with a malformed
  array, is replayed whole as before.
- On the `bridle` channel the `user` event's `id` is the incoming `messageId` — which is
  the browser's `clientMessageId` — so a reload can match a bubble with its saved copy.

Still desirable, not done: a `persisted` acknowledgement to the hub once the user event
is written, so "delivered" can mean "saved" rather than "handed over".
