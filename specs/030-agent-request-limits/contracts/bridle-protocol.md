# Contract: hub ↔ chat client

Additions to the protocol in `api/src/slices/bridle/domain/bridle.types.ts`.
The same text goes into `CleanSlice/bridle` `docs/PROTOCOL.md`. Nothing
existing changes shape.

## 1. Acknowledgement of `message`

`BridleSendAck` gains one rejected variant:

```ts
{
  status: 'rejected';
  code: 'RATE_LIMITED';
  /** Milliseconds until a request will be accepted. Always > 0. */
  retryAfterMs: number;
  /** The window that set the wait. */
  window: 'minute' | 'hour' | 'day';
}
```

- Returned only to a sender that passed a `clientMessageId` (the existing rule
  for acks).
- The message was not forwarded and no `user_message` echo was sent to the
  conversation's other sockets.
- Order of checks for one message: share link → attachments → empty →
  duplicate (`accepted`, `duplicate: true`) → `AGENT_OFFLINE` →
  `RATE_LIMITED` → `accepted`.

## 2. Event `agent_limit` (hub → browser)

```ts
// A limit of this agent is full and will stay so for a while.
{ limited: true; retryAfterMs: number; window: 'hour' | 'day' }
// Room was made earlier than announced.
{ limited: false }
```

Sent to **every** client socket of the agent, whatever its identity:

| When | Payload |
|------|---------|
| A socket connects and an hour or day window is full | `limited: true`, right after `welcome` |
| An accepted request fills an hour or day window | `limited: true` |
| Limits are raised or removed and nothing is full any more | `limited: false` |
| Limits are lowered or created and an hour or day window is now full | `limited: true` |

Never sent for a full **minute** window, and never sent when a window frees
by time passing — the client counts down by itself.

A client that receives it:

- stores `until = performance.now() + retryAfterMs` for the agent;
- limited senders show the notice and block sending;
- operators (Owner / Admin identity) show the operator's line and keep sending.

A client that does not know the event ignores it.

## 3. Sender without an acknowledgement

A sender that passed no `clientMessageId` and is refused receives, on its
conversation, a `message` event shaped exactly like the existing "Agent is not
connected" reply:

```text
This agent has reached its message limit. Try again in about 40 seconds.
This agent has reached its message limit. Try again in about 12 minutes.
This agent has reached its message limit. Try again in about 3 hours.
```

Seconds are rounded up to 10, minutes and hours up to the next whole one.
English only. It is not stored by the agent (the agent never saw the turn).

## 4. Source of a request (inside the API)

`IBridleSendOptions.source?: 'visitor' | 'operator' | 'peer'`, default
`'visitor'`. Only `'visitor'` can be refused or counted.

## 5. What the widget adds for the host page (`CleanSlice/bridle` 0.16.0)

- Custom-element event `limit` and `init({ onLimit })`:
  `{ limited: boolean, retryAfterMs?: number, window?: 'minute'|'hour'|'day' }`.
  Fired on a refused send, on `agent_limit`, and with `limited: false` when the
  wait ends.
- Options `limitLabel` (default "This agent has reached its message limit.")
  and `limitRetryLabel` (default "Try again in {time}."), also as
  `data-limit-label` / `data-limit-retry-label`. `{time}` is replaced by the
  countdown or the time of day.
- `instance.sendMessage()` and headless `client.send()` while limited: nothing
  is sent, the `limit` event fires again with the remaining wait.
