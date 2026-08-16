# Research: Agent Thinking Shimmer & Extended Thinking Display

**Feature**: [spec.md](./spec.md) | **Date**: 2026-08-14

All Technical Context unknowns resolved. Findings are grounded in a code survey of the four affected codebases (2026-08-14): `bridle` (SDK v0.14.0, canonical types, standalone hub), `runtime` (agent loop), `ranch` (production hub API + admin).

## Baseline facts (from code survey)

- The only generation-time UI today: `typing` event → three bouncing dots in `BridleChat.ce.vue` (`.bridle__typing`), cleared by the first `stream` event. `IBridleMessage.streaming` exists but is unused in the widget template.
- `typing` is emitted **only** inside `streamSend()` (`bridle/runtime/bridle.repository.ts:293`), which the runtime loop calls **only for the final response**. Tool-only LLM iterations emit nothing — the exact "silent gap" the spec targets (loop comment at `bridle/runtime/bridle.repository.ts:325` confirms tool-only iterations stream no text).
- Wire protocol (Socket.IO, websocket-only): agent → hub → browser events `typing` / `stream` (accumulated text, 100 ms batch) / `stream_end` / `message`. `BridlePart` union: `text|image|file|ui|ui_submit`. No thinking/step/tool types anywhere.
- Both hubs whitelist agent events via `@SubscribeMessage` (`ranch/api/src/slices/bridle/handlers/bridleAgentWs.handler.ts`, `bridle/nestjs/handlers/bridleAgentWs.handler.ts`); the client-bound relay (`handleAgentEvent` → `client.send`) is generic and forwards any payload by `clientId`.
- Client capabilities handshake already exists end-to-end: SDK sends `['streaming','images','files','ui']` at connect (`bridle/sdk/src/client.ts:84`), hub forwards on every message, runtime already parses it into message data (`runtime/.../bridle/bridle.repository.ts:368`).
- The runtime loop (`runtime/src/slices/runtime/loop/domain/loop.service.ts`) iterates `callLlm` → `response.toolCalls` → `executeToolCalls` per iteration; interleaved `response.text` accompanying tool calls is accumulated into the final answer. Tool names/iterations are the natural source of step labels.
- No shimmer CSS exists in any repo (ranch admin has an opacity-pulse `Skeleton.vue` only — not a gradient sweep).

## D1. Wire transport: new top-level `thinking` event (not a `BridlePart`)

- **Decision**: Add a new agent→hub→browser Socket.IO event `thinking` with its own typed payload (`IBridleThinkingEvent`), relayed by `handleAgentEvent` like `stream`/`typing`.
- **Rationale**: Thinking happens **before** any message stream exists — during tool iterations there is no `messageId` and no `stream` events to piggyback on, and `streamSend`'s empty-bubble protection (`chunksEmitted > 0`) actively avoids opening a stream early. A dedicated event decouples thinking timing from message streaming; the hub relay is already generic, so each hub only needs one new `@SubscribeMessage('thinking')` line.
- **Alternatives considered**:
  - *New `BridlePart` variant riding `stream.parts[]`* — rejected: wrong timing (no stream open during tool phases), would fight empty-bubble logic, and would bloat every accumulated-stream frame with repeated step data.
  - *Reusing the `debug` event* — rejected: admin-only fan-out by design, payload carries prompts/raw tool params that must never reach visitors (spec FR-008).

## D2. Step ↔ answer association: linear with `turnId` on the wire

- **Decision**: Every `thinking` event carries a `turnId` (UUID minted per loop run). The widget maintains one "open" thinking block, appends arriving steps to it, and freezes/attaches it to the assistant message on `stream_end`/`message`; `turnId` groups steps and guards against stragglers after a turn ends.
- **Rationale**: Conversation per client is linear (the runtime drains user clarifications into the *same* turn via `drainInbox`), so linear association is correct today; `turnId` future-proofs the contract without touching existing `stream`/`stream_end` payloads.
- **Alternatives considered**: threading a shared id into `stream`/`stream_end` — rejected: modifies existing event contracts, breaking the "strictly additive" constraint for no v1 benefit.

## D3. Step lifecycle & content mapping in the runtime loop

- **Decision**: Per LLM iteration that returns tool calls: emit one step per tool call with `state:'active'` before execution and `state:'done'` after. `label` = humanized tool name (underscores→spaces, sentence case; e.g. `search_kb` → "Search kb" refined by an optional per-tool display-label map). Interleaved `response.text` that accompanies tool calls is attached as `detail` on the iteration's first step — this is the model "thinking out loud" and maps to Rovo's expandable reasoning paragraphs.
- **Rationale**: Tool calls are the only structured signal of progress the loop has; interleaved text is the only reasoning prose available without prompt changes. Both are already visitor-safe by construction (tool *names* and model *prose*, never raw params — FR-008).
- **Note**: interleaved text also remains accumulated into the final answer (current behavior, unchanged) — minor duplication between an expanded step detail and the final text is accepted for v1 to avoid regressing final-answer content.
- **Alternatives considered**: emitting raw tool params as detail — rejected (FR-008); prompting the model for explicit step announcements — rejected for v1 (prompt-engineering risk, token cost; can layer on later without protocol change).

## D4. Story 1 trigger: emit existing `typing` at turn start

- **Decision**: The runtime loop emits the **existing** `typing` event once at turn start (before the first LLM call), not only inside `streamSend`. The widget renders the shimmer status line on `typing` and keeps it until the first `stream`/`message` for that turn.
- **Rationale**: Makes Story 1 work with zero protocol additions and improves old SDKs too (dots appear immediately instead of only at final-response streaming). The widget-side change from dots to shimmer is purely presentational.
- **Alternatives considered**: a dedicated `thinking_start` event — rejected: `typing` already means exactly this and is whitelisted everywhere.

## D5. Shimmer technique: CSS-only gradient sweep over text

- **Decision**: Shimmer = animated background gradient clipped to the status text (`background: linear-gradient(90deg, muted, bright, muted); background-size + animated background-position; -webkit-background-clip: text; color: transparent`), defined with existing `--bridle-*` tokens so both color modes work; `@media (prefers-reduced-motion: reduce)` replaces it with static muted text (state still communicated by the label itself). Step timeline uses the same BEM `.bridle__thinking*` class family with a thin vertical rule and chevron toggles, mirroring the Rovo reference.
- **Rationale**: CSS-only — no per-frame JS, no dependencies, works inside the shadow root, themable via the widget's established custom-property system.
- **Alternatives considered**: JS-driven animation or an animation library — rejected (bundle size, perf, shadow-DOM friction); opacity pulse à la ranch `Skeleton.vue` — rejected: the reference explicitly shows a traveling light sweep.

## D6. Capability gating: `'thinking'` in the existing handshake

- **Decision**: SDK adds `'thinking'` to the `capabilities` array at connect. The runtime emits `thinking` events only when the triggering message's `capabilities` includes `'thinking'`. The `typing`-at-turn-start emission (D4) is **not** gated — it's an existing event all clients understand.
- **Rationale**: The whole pipeline (SDK → hub → runtime message data) already carries capabilities; gating keeps Telegram and old web clients from receiving events they can't render, per the established `ui`-parts precedent.

## D7. Persistence: none — thinking is session-ephemeral

- **Decision**: Thinking steps live only in widget memory. They are not appended to session history on the runtime, not stored by hubs, and not replayed after page reload; a finished answer keeps its collapsed, re-expandable block for the lifetime of the page session only.
- **Rationale**: Satisfies every FR (FR-006 requires re-expand after completion, which in-memory state covers); persisting would touch session storage schemas in the runtime and transcript replay in the hub for marginal value. Matches reference-product behavior closely enough.
- **Alternatives considered**: storing steps as message `parts` in history — rejected: pollutes LLM-visible history and transcript sync, and requires filtering thinking parts out of the LLM context.

## D8. Rollout order & compatibility

- **Decision**: Deploy/release order: (1) hubs (ranch API + bridle standalone) accept-and-relay `thinking`; (2) runtime emits; (3) SDK release advertises the capability and renders. Any other order is *safe* but inert (see back-compat matrix in [contracts/thinking-event.md](./contracts/thinking-event.md)): unknown agent events are dropped by hub whitelists; unknown client events have no listener; capability gating stops emission toward old clients.
- **Rationale**: Strictly additive at every hop; no feature flag needed.

## D9. Admin chat preview parity (P3)

- **Decision**: Ranch admin Pinia store (`admin/slices/bridle/stores/bridle.ts`) subscribes to `thinking` and mirrors the widget's block/steps state; `Provider.vue`/`Message.vue` render shimmer + timeline with Tailwind, visually adapted (shadcn idiom), reusing the store's existing socket wiring. Admin connects with the `'thinking'` capability as well.
- **Rationale**: The admin preview speaks the wire protocol directly (own store, not the SDK), so parity is a rendering exercise; `DebugPanel.vue` remains unchanged (separate admin-only concern).

## D10. Status-line text & localization

- **Decision**: Status text = `«{title}» is thinking…` using the widget's existing `title` prop (the agent's display name in real embeds); no new init option in v1. Fixed English suffix follows the widget's existing hardcoded-strings approach ("Type a message…", "Start a conversation").
- **Rationale**: FR-003 asks for the configured display name — `title` is exactly that; inventing a localization system is out of scope and inconsistent with the rest of the widget.
- **Alternatives considered**: new `thinkingLabel` init option — deferred until an integrator asks; trivial to add later without breaking anything.
