# Contract: hub ↔ browser, hub ↔ agent

Namespace `/ws/client` (browsers) and `/ws/agent` (runtimes). One new frame;
two existing ones put to use.

## New: `conversation_reset` (hub → browser)

```json
{ "type": "conversation_reset", "ts": 1791000000000, "seq": 1791000000042 }
```

| Field | Meaning |
|-------|---------|
| `ts` | hub clock at the reset |
| `seq` | the conversation's next number, like every routed frame |

- Sent to **every** socket open on the conversation (`clientId` + `agentId`),
  the one that asked included.
- Routed through the numbered stream **after** the replay buffer is emptied,
  so it is the only frame a reconnecting browser is replayed.
- Carries no content and names no one: a visitor learns nothing from it.

**What a browser does with it**: accept it by `seq` like any frame, then empty
its record of the conversation — messages, thinking blocks, pending state,
notices, undelivered messages, staged files, the stored copy — and keep its
`lastSeq`. A browser that does not know the frame ignores it (the embed, an
older bundle): socket.io drops events nobody listens for.

| Console | Listener |
|---------|----------|
| app | `IBridleChannelEvents.onReset(seq)` → store's local reset |
| admin | `socket.on('conversation_reset')` in the store's `connect` → the field resets `resetTranscript` performs |

## Existing, now used by the app: `agent_status` (hub → browser)

```json
{ "type": "agent_status", "agentId": "…", "connected": true }
```

Sent on connect and whenever the agent joins or leaves the hub. The app
gateway starts listening (`onAgentStatus(connected)`); the store keeps it as
`agentOnline[key]`. Not numbered — it is state, not history, and is re-sent on
every connect.

## Existing: `session_clear` (hub → agent)

```json
{ "type": "session_clear", "channel": "share-ab12" }
```

Unchanged on the wire. Sent by `resetConversation`. The runtime drops the
in-memory session and its local file for `bridle:<channel>`.

Companion change in the runtime (research D13): cancel the session's running
tasks before clearing.

## Hub operations (`IBridleGateway`)

| Operation | Contract |
|-----------|----------|
| `isTurnOpen(agentId, clientId): boolean` | research D4; `false` for a conversation the hub has never seen |
| `resetConversation(agentId, clientId): void` | clears turn state and the replay buffer, sends `session_clear`, routes `conversation_reset`. Keeps sockets and `seq`. Safe to call for a conversation with no sockets. |
| `clearAgentSession` | becomes private to the hub; its two callers move to `resetConversation` |

## Ordering guarantee

Within one conversation the hub emits, in this order: the old conversation's
last frame → `conversation_reset` → the new conversation's first frame. A
browser that applies frames in `seq` order therefore never shows an old frame
after the reset.

## Specs owed

`data/bridle.gateway.channels.spec.ts` (existing, the per-conversation spec):

- `isTurnOpen`: accepted message → open; `typing` alone keeps it open; first agent `message` without a stream or
  thinking → closed; open stream → open until `stream_end`; thinking turn →
  open until `done`; any of them → closed after 75 s of silence;
- `resetConversation`: buffer holds only the reset frame; every socket got it;
  the agent got `session_clear`; `replaySince(0)` returns the reset frame
  alone; `seq` kept increasing.
