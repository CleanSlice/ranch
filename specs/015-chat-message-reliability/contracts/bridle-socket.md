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

## Agent ↔ hub (informative — runtime is outside this repository)

Required of the runtime for spec US3 and for exact de-duplication:

- Persist the incoming `messageId` as the `id` of the transcript's `user` event.
- Persist **one `assistant` event per emitted message**, with the wire `messageId` as
  its `id`, instead of one event per turn with concatenated text.

Desirable: a `persisted` acknowledgement to the hub once the user event is written, so
"delivered" can mean "saved" rather than "handed over".
