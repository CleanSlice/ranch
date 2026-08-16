# Data Model: Agent Thinking Shimmer & Extended Thinking Display

**Feature**: [spec.md](./spec.md) | **Contracts**: [contracts/](./contracts/) | **Date**: 2026-08-14

No persistent storage is involved (research D7). The model has two layers: the wire event (shared across repos) and the widget's in-memory view state.

## Wire entities (canonical: `bridle/nestjs/domain/bridle.types.ts`)

### ThinkingStep (payload fragment)

| Field | Type | Rules |
|-------|------|-------|
| `id` | `string` (UUID) | Unique per step; `state:'done'` events reuse the `id` of their `active` counterpart to update in place |
| `label` | `string` | Human-readable step name published by the agent (humanized tool name, D3). Non-empty. Visitor-safe by construction |
| `detail` | `string?` | Optional reasoning prose (markdown allowed, rendered like message text). Visitor-safe; never raw tool params/prompts (FR-008) |
| `state` | `'active' \| 'done'` | Lifecycle below |

### IBridleThinkingEvent (agent → hub → browser)

| Field | Type | Rules |
|-------|------|-------|
| `type` | `'thinking'` | Discriminator; added to `IBridleOutgoingEvent.type` union |
| `clientId` | `string` | Routing key — hub relays via existing `handleAgentEvent` |
| `turnId` | `string` (UUID) | Minted once per loop run; groups all steps of one answer (D2) |
| `step` | `ThinkingStep?` | Present on step updates; absent on the terminal event |
| `done` | `boolean?` | `true` on the terminal event of a turn (no `step`); closes the open block. Emitted on every loop exit path, including cancellation |
| `ts` | `number` | Epoch ms |

**Validation**: hubs relay opaquely (no payload validation, same as `stream`); the client ignores step events for a `turnId` whose block is already frozen (straggler guard).

### Mirrors (updated in the same change)

- `bridle/sdk/src/types.ts` — SDK copy + client-side `IThinkingBlock` (below).
- `ranch/api/src/slices/bridle/domain/bridle.types.ts` — hub mirror.
- `ranch/admin/slices/bridle/stores/bridle.ts` — admin store mirror (US3).

## Widget view state (SDK `BridleChat.ce.vue`; mirrored in ranch admin store for P3)

### IThinkingBlock (in `types.ts`)

| Field | Type | Rules |
|-------|------|-------|
| `turnId` | `string` | From first event that opened the block |
| `steps` | `ThinkingStep[]` | Arrival-ordered; `done` events update the matching `id` in place |
| `status` | `'thinking' \| 'done'` | `thinking` while the turn is open; `done` once frozen |
| `ts` | `number` | Arrival anchor, clamped after the last on-screen message (guards against agent/browser clock skew) |

Collapse/expand toggles (`collapsedBlocks` per `turnId`, `expandedSteps` per step id) are component-local view state, not part of the shared type: unset means the default — block open while thinking, collapsed once done (FR-006); steps arrive collapsed (FR-004).

### Relationships

- Blocks are **their own in-flow chat items**, interleaved with messages by `ts`. They are not attached to a message object — tool-call iterations can stream interim bubbles mid-turn, which makes "the" answer message ambiguous.
- **A turn spans one or more segments** (`IThinkingBlock.seg` ordinal): a segment *seals* (collapses) the moment a new visible assistant bubble lands below it, and the turn's next step opens a fresh segment under that message — the current activity always renders at the bottom of the flow, Rovo-style. A `done` step update lands in whichever segment holds its step id, even after that segment sealed.
- At most **one** open (`status:'thinking'`) segment exists per client (linear conversation, D2); a new turn's first step force-closes other turns' segments.
- **Seal vs close**: sealing collapses a segment but leaves the *turn* open; terminal paths — the `done: true` event, the ~75 s inactivity watchdog, socket `close` — additionally mark the turn closed (client-side straggler set) so late steps can't resurrect a segment. Mid-turn `stream_end`s never close the turn.
- **Auto-follow**: the chat scrolls to new content only when the reader is already near the bottom (~80 px) — a reader who scrolled up is never yanked back down.
- The shimmer status line is **derived state**, not stored: shown while `isTyping` or an open block exists; the open block's own header carries the shimmer once steps appear.

## State transitions

```text
Turn lifecycle (widget):
  idle ──typing event──▶ SHIMMER (bare status line, no steps yet)
       ──thinking(turnId, step)──▶ SHIMMER+TIMELINE (block open, steps arriving;
                                        interim bubbles may stream between steps)
       ──final stream/message text──▶ ANSWER STREAMING (text grows below the
                                        still-open block)
       ──thinking(done: true)──▶ DONE (block frozen, auto-collapsed to a
                                        re-expandable summary row)
  Any state ──75s inactivity watchdog / socket close──▶ DONE (no infinite shimmer)

Step lifecycle:  (created) active ──same-id done event──▶ done
  Active step renders visually distinct (FR-007); all steps forced done when block freezes.
```

## Runtime-side additions (no stored data)

- `ILoopContext.sendTyping?()` — best-effort indicator ping, fired at turn start and before each tool batch; wired only for external turns.
- `ILoopContext.sendThinking?(turnId, step?)` — step publish (`step` set) or terminal turn-completion (`step` omitted); wired only when the triggering message's `capabilities` includes `'thinking'` (D6), so the loop's calls no-op for everyone else.
- `IChannelGateway.sendTyping?` / `sendThinking?` — optional methods mirroring the `streamSend?` pattern; implemented only by the bridle channel repository.
