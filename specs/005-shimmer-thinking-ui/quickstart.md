# Quickstart: Validating the thinking shimmer & timeline

**Feature**: [spec.md](./spec.md) | **Contracts**: [contracts/](./contracts/) | **Date**: 2026-08-14

End-to-end validation runs the local chain **example page → SDK → standalone hub → runtime agent**. The production-hub path (`ranch/api`) is covered by typecheck + the admin parity scenario.

## Prerequisites

- Repos checked out side by side: `bridle`, `runtime`, `ranch` (feature branches of each).
- `bun` installed (bridle dev workflow) and Node 20+.
- A runtime agent configured with at least one tool that takes a few seconds (any search/read tool works) — thinking steps only appear when the LLM actually calls tools.

## Setup

```bash
# 1. Local hub (standalone, from bridle repo)
cd ~/my-knowledge/bridle && make hub          # NestJS hub on its default port

# 2. SDK watch build
cd ~/my-knowledge/bridle/sdk && bun install && bun run dev   # vite build --watch

# 3. Example embed page (serves example/index.html with the built SDK)
cd ~/my-knowledge/bridle/example && node server.js

# 4. Runtime agent pointed at the local hub
cd ~/my-knowledge/runtime
BRIDLE_API_URL=<local hub url> BRIDLE_API_KEY=… BRIDLE_AGENT_ID=… <repo's usual run command>
```

Static gates (run in each touched repo before scenario testing):

```bash
cd ~/my-knowledge/bridle/sdk && bun run typecheck && bun run build   # vue-tsc + vite + dts
cd ~/my-knowledge/ranch/api && npx tsc --noEmit
cd ~/my-knowledge/runtime   && npx tsc --noEmit
```

## Scenario 1 — Shimmer status (spec US1, P1)

1. Open the example page, send a message that triggers tool use ("search X and summarize").
2. **Expect** within ~1 s: shimmering `«<title>» is thinking…` line (not three dots), animation = traveling light sweep per [widget-thinking-ui.md](./contracts/widget-thinking-ui.md).
3. **Expect**: the line stays animated through the whole tool phase — at no point is the chat visually idle (US1-AS3).
4. **Expect**: first answer tokens replace the shimmer without flicker; a trivial "hi" round-trip shows no artifacts (edge: instant answers).

## Scenario 2 — Thinking timeline (spec US2, P2)

1. Same message; watch the block under the status line.
2. **Expect**: steps appear live, arrival-ordered, collapsed; active step visually distinct from done steps (FR-007).
3. Click a step with detail → prose expands under the label (markdown rendered); click again → collapses. Scroll position must not jump.
4. After the answer completes: block auto-collapses to a summary row above the answer; clicking re-expands full timeline (FR-006). Compare side-by-side with the Rovo reference screenshot (SC-002 sign-off).
5. Ask something needing no tools → status line only, **no** empty timeline (US2-AS5).

## Scenario 3 — Degradation & compatibility (FR-009; matrix in [thinking-event.md](./contracts/thinking-event.md))

1. Old SDK vs new runtime: point the example page at the previous published SDK build → dots appear at turn start, no errors in console, answers unchanged.
2. New SDK vs old hub: run hub without the `thinking` whitelist commit → shimmer works (Story 1), timeline absent, no errors.
3. Telegram channel (if configured): behavior unchanged.

## Scenario 4 — Theming & accessibility (FR-010, FR-011)

1. Toggle `colorMode` light/dark and both built-in themes on the example page → shimmer/timeline legible and on-token in all four combos.
2. Enable OS reduced-motion → status text static (no sweep), state still communicated; expand/collapse still works.
3. Screen reader / accessibility tree: block exposes `role="status"`; chevrons report `aria-expanded`.

## Scenario 5 — Admin parity (spec US3, P3)

1. Run ranch admin locally, open an agent's chat preview (Agent → Chat tab), send a tool-using message.
2. **Expect**: same shimmer + timeline behavior, admin styling; DebugPanel (ⓘ) unchanged.

## Sign-off checklist

- [ ] All five scenarios pass; SC-001…SC-005 from [spec.md](./spec.md#success-criteria-mandatory) verified
- [ ] Typecheck/build gates green in bridle sdk, ranch api, runtime
- [ ] Task owner approves style match vs Rovo reference (SC-002)
