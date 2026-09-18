# Implementation Plan: Chat message reliability

**Branch**: `fix/CLEAN-102-chat-message-reliability` (spec dir `015-chat-message-reliability`) | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-chat-message-reliability/spec.md`, plus
the planning request: "что насчёт сообщений где порядок не правильный? и при отправке
сообщения нужно скроллить вниз если мы где-то наверху, это обычное поведение".

**Note**: `setup_plan.py` was not run — Python is not installed on this machine. The
plan file and feature directory were set up by hand; `.specify/feature.json` points at
this feature.

## Summary

The chat loses, doubles and reorders messages because it has no delivery confirmation,
no stable message identity, no recovery of missed events, and orders the timeline by
timestamps taken from two different clocks. The plan fixes these at their source rather
than per symptom:

1. **Order by arrival sequence, not by time** (answers the ordering question directly —
   see below). Time becomes display-only.
2. **Acknowledged sends** with a client-generated message id, an idempotent hub, and a
   per-device outbox — gives "sending / slow / delivered / not delivered", Resend, and
   survival across reloads.
3. **Hub replay buffer** so events that arrive while a browser is reconnecting are
   delivered afterwards — fixes hung answers and the landing → agent handoff.
4. **Conversation-scoped chat state** in the admin store and reference-counted channel
   ownership in the app store — stops two chat views from clobbering each other.
5. **Timestamps and delivery state under each message**, and one scroll rule: sending
   always scrolls to the bottom, incoming content only follows a reader already there.
6. **Message boundaries in the transcript** — a change in the sibling repository
   `CleanSlice/runtime` (see Dependencies).
7. **Several sockets per identity** *(added after the local experiments)* — the hub keeps
   one socket per identity and every Owner/Admin shares the identity `admin`, so the last
   view to connect takes all events and earlier views go silent. Reproduced (research
   E3/F10). The hub fans out to every socket of the identity.
8. **Single source of truth for agents** *(added on request; approach set by the
   request: SSOT, so the class of defect does not come back)* — the list row stays on
   "Deploying" while the detail shows "Failed" because the same agent exists as several
   independent copies (research F11). An agent lives once in `agentStore`; every fetch
   upserts into it, the status stream patches it, components render from it by id — in
   both `admin/` and `app/` (research D12).

**Testing approach** (per the request: test whichever way is convenient; the goal is to
find the cause and fix the defect): no test-first mandate. Hub behaviour is checked with
the existing jest specs and the scripted socket probe; ordering, delivery and
reconciliation logic as pure functions with `bun test`; browser-only behaviour with a
headless Playwright script where that is quicker than doing it by hand.

**What has been reproduced** (local stack, scripted socket client — research "Update:
experiments"): no delivery ack (E1), three unrelated ids per message (E2), a second view
stealing the first one's events (E3), an answer lost across a reconnect while the
transcript has it (E4). **Not yet observed in a browser**: the ordering bug (needs clock
skew), scrolling, the landing-page handoff (F5) and the admin store clobbering (F3).

### The ordering question, answered

The wrong order has a concrete cause, confirmed in the source (research F1). Both chat
views sort the timeline with `items.sort((a, b) => a.ts - b.ts)`. Your message carries
the **browser's** clock; the agent's messages carry the **agent's** clock. When the
browser clock is ahead by more than the agent's response time, the reply sorts above
your question — so your message "drops below" it. It is intermittent because it depends
on the skew and on how quickly the first agent message arrives (a greeting or a short
acknowledgement arrives in milliseconds).

Fix (research D1): every item gets a per-conversation sequence number when it is
appended, and the view orders by that. Arrival order is the order you experienced, and
clock skew cannot affect it. This is the first implementation slice because it is small,
self-contained and removes the most visible artifact.

The duplicate in the same screenshot is a different defect (research F5/F2 — the send
that silently went nowhere and was sent again); it is covered by items 2–4.

## Technical Context

**Language/Version**: TypeScript 5.x throughout. API: NestJS on Bun/Node. Clients: Nuxt 4
/ Vue 3 (`app/` console with Pinia setup stores and i18n; `admin/` with a Pinia options
store, English only).

**Primary Dependencies**: socket.io (server + client) for the hub; Pinia; generated
OpenAPI SDK (`openapi-ts`) for HTTP. No new runtime dependency is planned.

**Storage**: No database change. Browser `localStorage` (app: existing
`bridle:conversation:<key>` gains fields; admin: new `bridle:outbox:<agentId>:<channel>`).
Hub state stays in memory (new bounded replay buffer and seen-id cache). Transcript JSONL
on S3 is written by the agent runtime and only read here.

**Testing**: API — jest (`cd api && bun run test`), extending the existing specs.
`app/` and `admin/` have no test runner; pure logic goes under each slice's `utils/` and
is covered with `bun test` (no new dependency). UI behaviour is validated via
[quickstart.md](./quickstart.md). Type safety: `npx nuxt typecheck` in `app/` and
`admin/` (not `bun run typecheck` in `app/` — it regenerates the SDK).

**Target Platform**: Browsers (desktop first) against the API in the k3s cluster; local
stack via the repo's Makefile.

**Project Type**: Web application — one API, two web clients sharing a wire protocol.

**Performance Goals**: Delivery state visible within 5 s (slow) / 30 s (failed). A
finished answer visible in an open chat within 10 s in ≥ 99 % of turns (SC-005). Replay
after reconnect completes before live traffic resumes.

**Constraints**: The `message` wire contract is shared with the embed widget — every
protocol change must be additive and optional. The hub is single-instance in memory
(already true today). New user-visible strings in `app/` follow `docs/i18n.md`. The
agent runtime's source is outside this repository.

**Scale/Scope**: Two chat surfaces (three entry points in the app: landing hero, agent
page, share page; two in the admin: Rancher panel, agent chat tab), one hub, one
transcript reader. Roughly: API ~4 files + specs, app ~8 files, admin ~5 files, where
the admin store refactor (singleton → conversation-scoped) is the largest piece.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template — it defines no
principles, so there are no constitutional gates to evaluate. The gates applied instead
are the repository's own rules (`CLAUDE.md`, `.cursor/rules/project.mdc`):

| Gate | Status |
|------|--------|
| Work tracked under a `CLEAN-` id, branch from `origin/main` | Pass — CLEAN-102, `fix/CLEAN-102-chat-message-reliability` |
| No hand-written types where OpenAPI generates them | Pass — HTTP surface unchanged except reuse of the existing transcript route; socket payload types are not OpenAPI-generated |
| `app/` strings via `en.json` + `i18n:sync`; `admin/` English only | Pass — planned in D9 |
| Slice structure respected (`data/`, `domain/`, `stores/`, `components/`, `utils/`) | Pass — see Project Structure |

**Post-design re-check**: unchanged. No violations, Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/015-chat-message-reliability/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0 — findings F1–F9, decisions D1–D10, open items
├── data-model.md        # Phase 1 — client-side entities and state machines
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/
│   └── bridle-socket.md # Phase 1 — additive changes to the browser ↔ hub protocol
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
api/src/slices/bridle/
├── handlers/bridleClientWs.handler.ts   # ack callback, clientMessageId, lastSeq handshake
├── data/bridle.gateway.ts               # forward client id, seen-id cache, per-client seq + replay buffer
├── domain/bridle.types.ts               # additive payload types
├── domain/bridle.gateway.ts             # interface additions
└── (specs next to each file)
api/src/slices/agent/file/domain/
└── transcriptReader.service.ts          # file-order tie-break, per-message assistant events

app/slices/bridle/
├── domain/bridle.types.ts               # seq, delivery, clientMessageId on IBridleMessage
├── domain/bridle.gateway.ts             # send() returns an ack promise; transcript tail
├── data/bridle.gateway.ts               # emit with ack + timeout, lastSeq in handshake
├── stores/bridle.ts                     # seq, delivery machine, outbox, acquire/release, replay
├── utils/chatFlow.ts                    # pure: ordering + day separators            (new, tested)
├── utils/delivery.ts                    # pure: state machine + thresholds           (new, tested)
├── components/bridle/chat/Provider.vue  # order by seq, scroll rule
├── components/bridle/chat/Message.vue   # time, delivery state, Resend / Discard
└── i18n/locales/en.json                 # new keys → `bun run i18n:sync` (never hand-write ru.json)

admin/slices/bridle/
├── stores/bridle.ts                     # conversation-scoped state, ack, outbox, replay, seq
├── utils/chatFlow.ts, utils/delivery.ts # same pure logic as the app                 (new, tested)
├── components/bridle/Provider.vue       # order by seq, scroll on send
└── components/bridle/Message.vue        # time, delivery state, Resend / Discard
admin/slices/rancher/components/rancher/Provider.vue   # passes its own conversation key
```

**Structure Decision**: No new slice and no shared package. `app/` and `admin/` are
separate Nuxt projects with no shared workspace library today, so the two small pure
modules (`chatFlow`, `delivery`) are duplicated rather than introducing cross-project
packaging for this fix; the duplication is deliberate and noted for a later cleanup.

## Implementation slices (order)

Each slice is independently shippable; the order follows the spec's priorities and puts
the cheapest high-value fix first.

1. **Ordering by sequence + scroll rule** (both clients, no API change) — spec US2,
   FR-006/007/024/025. Smallest change, removes the most visible artifact.
2. **Timestamps under messages** (both clients) — US5 part 1, FR-017/018.
3. **Acknowledged send + idempotent hub + delivery states + outbox** (API + both
   clients) — US1, US5 part 2, FR-001–005, 019–021.
4. **Channel ownership (app) and conversation-scoped store (admin)** — US1/US2,
   FR-001/008; removes the handoff and cross-chat clobbering.
5. **Hub replay buffer + reconnect catch-up + transcript safety net** — US4,
   FR-012/014–016.
6. **Transcript boundaries** — US3, FR-010–013. API reader part here; the runtime part is
   a separate ticket and PR in `CleanSlice/runtime`.
7. **Agent status consistency (admin)** — US6, FR-027. Independent of everything above;
   small; can ship as its own PR at any point.

**Fan-out to several sockets per identity** (FR-026, research D11) is part of slice 3's
hub work: the ack, the seen-id cache, the sequence and the replay buffer are all keyed by
identity, so the registry has to become multi-socket before they are built on it. It is
the change most likely to remove "the answer never arrived" reports on its own.

Slices 3 and 4 touch the same admin store; 4 is sequenced after 3 only for the app —
for the admin the refactor in 4 should land **before** 3 to avoid writing the outbox
twice. `/speckit-tasks` should order them that way.

## Dependencies and risks

- **Agent runtime — `CleanSlice/runtime`, sibling checkout `../runtime`** — needed for
  slice 6 (one transcript event per emitted message with the wire `messageId` as its id;
  persist the forwarded user `messageId`) and for closing the delivered-vs-saved gap in
  D2. Confirmed in its source: `loop.service.ts` `sendFinalResponse` writes one
  `assistant` event per turn with the accumulated text and a random id. Without that
  change US3 cannot be met for the admin and the chat history pages; everything else can
  ship. It needs its own ticket, branch and PR in that repository.
- **Local validation gap** — on this Windows machine the runtime's session file lands in
  an NTFS alternate data stream and the API's transcript route returns nothing, so
  reload-from-transcript scenarios must be validated on the cluster.
- **Two hypotheses (F3, F5)** are not reproduced. The fixes in slice 4 are sound
  independently, but the claim that they explain the vanished landing-page question must
  be confirmed in a running stack.
- **Embed widget compatibility** — all wire changes are optional fields and an optional
  ack; a client that sends neither behaves as today.
- **Single API instance** — the replay buffer and seen-id cache are in memory.

## Complexity Tracking

No constitution violations to justify.
