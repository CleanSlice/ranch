# Implementation Plan: Agent Thinking Shimmer & Extended Thinking Display

**Branch**: `feat/CLEAN-10-shimmer-thinking` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-shimmer-thinking-ui/spec.md`

## Summary

Replace the Bridle widget's three-dot typing indicator with a Rovo-style shimmering "«Agent» is thinking…" status line that covers the entire generation window (today tool-use iterations show nothing at all), and add an extended-thinking timeline: live, named, expandable steps published by the agent runtime while it works. Technically this is (1) an additive Socket.IO wire event `thinking` flowing agent runtime → hub → browser, capability-gated by the existing `capabilities` handshake; (2) an early `typing` emission at turn start in the runtime loop so the status appears immediately; (3) CSS-only shimmer + timeline UI inside the widget's shadow DOM using existing `--bridle-*` theme tokens; (4) P3 parity in the ranch admin chat preview.

## Technical Context

**Language/Version**: TypeScript 5.x everywhere. Vue 3 (SDK custom element, `defineCustomElement`), NestJS (hub in `ranch/api` + standalone hub in `bridle/nestjs`, agent runtime in `runtime/`), Nuxt 3 (ranch admin).

**Primary Dependencies**: socket.io / socket.io-client (websocket transport only), Vue 3, `marked` (widget markdown), Vite (SDK lib build, `@cleanslice/bridle` v0.14.0), Tailwind + shadcn-vue (ranch admin), bun (bridle dev workflow).

**Storage**: N/A — thinking steps are ephemeral, in-memory in the browser widget for the session; nothing persisted on hub or runtime (see research.md D7).

**Testing**: SDK: `vue-tsc --noEmit` + `vite build`; ranch API and runtime: `tsc --noEmit` (repo practice — no dedicated test runner for these slices); end-to-end: manual validation via `bridle/example` page + local hub + runtime agent per quickstart.md.

**Target Platform**: Evergreen browsers (widget is a shadow-DOM custom element; CSS `background-clip: text` with `-webkit-` prefix); Node 20+/bun for services.

**Project Type**: Multi-repo web feature: embeddable SDK widget + two hub codebases + agent runtime + admin UI.

**Performance Goals**: Shimmer and timeline must be CSS-only animations (no per-frame JS), no additional re-renders beyond the existing 100 ms stream batching; chat stays responsive on typical devices.

**Constraints**: Wire protocol changes must be strictly additive — every old/new combination of SDK, hub, and runtime keeps working (back-compat matrix in contracts/thinking-event.md). Widget styles live inside the shadow root and must theme via `--bridle-*` custom properties (light/dark). `prefers-reduced-motion` disables the shimmer. Visitor-facing stream must never carry admin-only data (spec FR-008): thinking events carry only agent-published labels/detail, never raw tool params or prompts.

**Scale/Scope**: One conversation per widget instance; timelines of up to a few dozen steps per answer (runtime cap `maxIterations` already bounds this); 4 codebases touched, ~10 files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific principles are ratified. Applying general defaults in its place:

- **Simplicity**: PASS — one new wire event type, no new services, no storage, no new dependencies; UI is plain CSS in the existing SFC.
- **Additive contracts**: PASS — new event is ignored by old hubs (no `@SubscribeMessage` → dropped) and old clients (no listener); gated by the existing capabilities handshake so old runtimes/new runtimes never break old clients.
- **Test-first practicality**: PASS with note — repos have typecheck-only gates; validation is scenario-driven via quickstart.md.

**Post-design re-check (after Phase 1)**: PASS — design added no storage, no new deps, no cross-cutting abstractions beyond one optional channel-gateway method mirroring the existing `streamSend?` pattern.

## Project Structure

### Documentation (this feature)

```text
specs/005-shimmer-thinking-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions D1–D10
├── data-model.md        # Phase 1 output — wire event + client-side state model
├── quickstart.md        # Phase 1 output — E2E validation guide
├── contracts/
│   ├── thinking-event.md      # Socket.IO wire contract + back-compat matrix
│   └── widget-thinking-ui.md  # Widget UI/theming/accessibility contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

Feature spans four codebases; the spec repo (`ranch`) is one of them.

```text
/Users/maksymtmk/my-knowledge/bridle/            # SDK + canonical protocol + standalone hub
├── nestjs/
│   ├── domain/bridle.types.ts                   # canonical wire types: + IBridleThinkingEvent, 'thinking' in IBridleOutgoingEvent
│   └── handlers/bridleAgentWs.handler.ts        # + @SubscribeMessage('thinking') relay
├── runtime/bridle.repository.ts                 # agent-side lib: + sendThinking() emit helper
├── sdk/src/
│   ├── types.ts                                 # manual mirror: + thinking types, IBridleMessage.thinking
│   ├── client.ts                                # + 'thinking' capability, socket.on('thinking'), typed on() overload
│   └── BridleChat.ce.vue                        # shimmer status line, thinking timeline UI + CSS (shadow DOM)
└── docs/docs/protocol/streaming.md              # protocol doc: thinking event section

/Users/maksymtmk/my-knowledge/runtime/           # agent runtime (emits thinking)
└── src/slices/
    ├── runtime/loop/domain/loop.service.ts      # turn-start typing, per-tool-call thinking steps
    ├── runtime/loop/domain/loop.types.ts        # ILoopContext: + sendThinking
    └── setup/channel/
        ├── domain/channel.gateway.ts            # IChannelGateway: + optional sendThinking?
        ├── domain/channel.service.ts            # route sendThinking to capable channels
        └── data/repositories/bridle/bridle.repository.ts  # emit 'thinking' over socket (capability-gated)

/Users/maksymtmk/my-knowledge/ranch/             # production hub + admin (this repo)
├── api/src/slices/bridle/
│   ├── domain/bridle.types.ts                   # mirror: + IBridleThinkingEvent
│   └── handlers/bridleAgentWs.handler.ts        # + @SubscribeMessage('thinking') → gateway.handleAgentEvent
└── admin/slices/bridle/                         # P3 parity
    ├── stores/bridle.ts                         # + socket 'thinking' handler
    └── components/bridle/{Provider,Message}.vue # shimmer + timeline (Tailwind)
```

**Structure Decision**: No new directories or modules anywhere — every change lands in existing files/slices listed above, following each repo's established layered pattern (`domain`/`data`/`handlers` in NestJS slices, single SFC in the SDK). The canonical wire types stay in `bridle/nestjs/domain/bridle.types.ts` with the two existing manual mirrors (`bridle/sdk/src/types.ts`, `ranch/api/.../domain/bridle.types.ts`) updated in the same change.

## Complexity Tracking

No constitution violations — table not applicable.
