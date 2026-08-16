# Wire Contract: `thinking` event

**Feature**: [spec](../spec.md) | **Data model**: [data-model.md](../data-model.md) | **Date**: 2026-08-14

Transport: Socket.IO (websocket only), same channels as existing `stream`/`typing` events. Strictly additive — no existing event payload changes.

## Hop 1 — Agent runtime → Hub (`/ws/agent` namespace)

Emitted by the runtime's bridle channel repository (`sendThinking`), only when the triggering incoming message advertised the `thinking` capability.

```jsonc
// socket.emit('thinking', payload) — step update
{
  "type": "thinking",
  "clientId": "abc123",          // routing key, required
  "turnId": "550e8400-…",        // UUID per loop run, required
  "step": {
    "id": "9b2d…",               // UUID per step; 'done' reuses the 'active' id
    "label": "Search knowledge base",  // required, non-empty, visitor-safe
    "detail": "I'm looking for…",      // optional markdown prose, visitor-safe
    "state": "active"            // 'active' | 'done'
  },
  "ts": 1765700000000
}

// socket.emit('thinking', payload) — terminal turn-completion event
// (no `step`; emitted once per turn on every loop exit path, including
// cancellation — the client freezes and collapses the open block on it)
{
  "type": "thinking",
  "clientId": "abc123",
  "turnId": "550e8400-…",
  "done": true,
  "ts": 1765700000000
}
```

Hub handling (both hubs — `ranch/api/src/slices/bridle/handlers/bridleAgentWs.handler.ts` and `bridle/nestjs/handlers/bridleAgentWs.handler.ts`):

```
@SubscribeMessage('thinking') → gateway.handleAgentEvent(agentId, data)
```

Opaque relay by `clientId` — identical to `stream`. **Not** admin-gated (unlike `debug`): payload is visitor-safe by contract; the runtime must never place prompts/raw tool params in `label`/`detail` (spec FR-008).

## Hop 2 — Hub → Browser (`/ws/client` namespace)

Payload forwarded verbatim: `client.emit('thinking', payload)` via the existing generic pass-through. SDK/client subscription:

```ts
socket.on('thinking', (e: IBridleThinkingEvent) => …)   // new listener in BridleClient
client.on('thinking', handler)                           // new typed overload on the public API
```

## Capability handshake (existing mechanism, one new token)

```ts
// bridle/sdk/src/client.ts — connect auth
capabilities: ['streaming', 'images', 'files', 'ui', 'thinking']
```

Hub already forwards `capabilities` on every message to the agent; runtime already parses it into message data. Emission rule: **no `thinking` capability on the triggering message → no `thinking` events for that turn.** The turn-start `typing` emission (research D4) is not gated.

## Sequencing per turn

```
Browser            Hub               Runtime
  │ message ───────▶│ message ───────▶│  turn starts (turnId minted)
  │◀─────── typing  │◀─────── typing  │  immediately, before first LLM call
  │◀─ stream ×N / stream_end          │  interleaved text of a tool-call iteration
  │                                   │  (streams as its own bubble — existing behavior)
  │◀─────── typing                    │  before each tool batch (keeps indicator alive)
  │◀─ thinking(step S1 active)        │  before tool executes
  │◀─ thinking(step S1 done)          │  tool finished
  │◀─ thinking(step S2 active/done)…  │  further iterations
  │◀─ stream (accumulated text) ×N    │  final response streaming
  │◀─ stream_end                      │
  │◀─ thinking(done: true)            │  terminal — closes the block (all exit paths)
```

Ordering guarantee: single socket per hop ⇒ events arrive in emission order. The client freezes the block on the terminal `done: true` event (mid-turn `stream_end`s of interleaved bubbles must NOT freeze it); backstops are an inactivity watchdog (~75 s without turn events) and the socket `close` event. `thinking` events for an already-frozen `turnId` are ignored. On streaming channels the iteration's interleaved text streams as its own bubble, so the runtime omits `step.detail` there to avoid showing the same prose twice; `detail` is populated on non-streaming paths.

## Backward/forward compatibility matrix

| SDK | Hub | Runtime | Behavior |
|-----|-----|---------|----------|
| old | old | old | Unchanged (dots at final streaming only) |
| old | any | new | Dots appear at **turn start** (D4 `typing`) — strict improvement; no `thinking` emitted (capability absent) |
| new | old | new | Shimmer on `typing`; runtime may emit `thinking` but old hub whitelist **drops** it silently → Story 1 only |
| new | new | old | Shimmer only at final streaming (runtime never emits early `typing`/`thinking`) — no worse than today |
| new | new | new | Full feature |

Rollout order (research D8): hubs → runtime → SDK release. Every partial state is safe.

## Non-browser channels

Telegram (and any client not advertising `thinking`) receives nothing new: `IChannelGateway.sendThinking?` is optional and only the bridle repository implements it; capability gating is the second guard.
