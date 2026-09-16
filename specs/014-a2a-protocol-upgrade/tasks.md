# Tasks: A2A v2 — external agents and delegation that fires

**Input**: Design documents from `/specs/014-a2a-protocol-upgrade/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R7, R5 amended: tab key → `a2a`
with legacy alias), data-model.md, contracts/peers-v2-api.md, quickstart.md

**Tests**: included — the peer slice is spec-per-file by house convention (CLEAN-74),
and quickstart §1 names the expected assertions. Write each spec before or with its
implementation; the poisoned-stub pattern guards secrets.

**Organization**: grouped by user story; stories are independently testable. US1 is
the MVP.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 Baseline green: `cd api && bun run test -- peer askAgent a2a mcp-tools`,
      `cd admin && bun run typecheck` — record any pre-existing failure before touching
      code (stack: branch `feat/CLEAN-95-a2a-protocol-upgrade`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema and shared types every story reads. No story work before this.

- [ ] T002 Prisma schema (api/prisma/schema.prisma): `AgentPeer` — `peerAgentId` and
      `token` nullable, add `origin String @default("internal")`, `outboundToken
      String?`; `AgentDelegation.peerAgentId` nullable; `Agent` — add `peersServedAt
      DateTime?`, `peersServedHash String?`; partial unique index `(agentId, cardUrl)`
      where origin external. Additive migration via `cd api && bun run migrate`
      (data-model.md invariants)
- [ ] T003 Domain types (api/src/slices/agent/peer/domain/peer.types.ts): `PeerOrigins`
      (`internal`/`external`), `IAgentPeerData.origin`/`outboundToken?`, nullable
      `peerAgentId`, `IPeersState { armed, servedAt }`
- [ ] T004 Mapper (api/src/slices/agent/peer/data/peer.mapper.ts): map `origin`,
      default legacy rows to `internal`; never map `token`/`outboundToken` outward;
      external rows → `peerStatus: 'external'`, `peerExists: true`
- [ ] T005 Peer gateway (api/src/slices/agent/peer/domain/peer.gateway.ts + data impl):
      `findByCardUrl(agentId, canonicalUrl)`, `updateExternal(rowId, …)`, and
      serve-state accessors `recordPeersServed(agentId, hash)` /
      `readPeersServed(agentId)`

**Checkpoint**: schema + types compiled; `bunx tsc --noEmit` green in api/

---

## Phase 3: User Story 1 — a connected peer actually gets asked (P1) 🎯 MVP

**Goal**: the model delegates instead of "I don't know" (FR-006/007/011); the console
shows armed/pending and offers Restart now (FR-008).

**Independent Test**: quickstart §5 (10/10 policy runs on a local pair) + §4.3
(armed → pending → Restart now → armed).

### Tests for User Story 1

- [ ] T006 [P] [US1] Extend api/src/slices/agent/peer/askAgent.tool.spec.ts: the
      description contains the give-up rule (R3 text) **before** the "not a first
      resort" caveat; explicit-naming sentence present; serving the list records
      `peersServedAt`/`peersServedHash`; hash covers membership (changes on
      connect/remove, stable across same-membership re-serve)
- [ ] T007 [P] [US1] Extend api/src/slices/agent/peer/peer.controller.spec.ts:
      `GET /agents/:id/peers/state` — Owner/Admin JWT required; `armed:true` iff
      stored hash matches current peers; `servedAt:null` when never served

### Implementation for User Story 1

- [ ] T008 [US1] askAgent.tool.ts: add the FR-011 policy paragraph to
      `BASE_DESCRIPTION` (exact text in research R3); call
      `recordPeersServed` from `describeForRequest`/`isListedForRequest` after a
      successful listing
- [ ] T009 [US1] peer.service.ts + peer.controller.ts + dtos/peersState.dto.ts:
      `peersState(agentId)` computing `armed` (hash of sorted current row ids vs
      stored), new `GET /agents/:agentId/peers/state` route with the standard envelope
      (contracts/peers-v2-api.md)
- [ ] T010 [US1] Regenerate clients: `cd api && bun run build && bun run
      generate:swagger`, then `cd admin && bun run build:api` — SDK gains
      `getAgentPeersState`
- [ ] T011 [US1] Admin data/domain (admin/slices/agent/peer/data/peer.gateway.ts,
      domain/peer.service.ts, domain/peer.types.ts): `peersState(agentId)` returning
      `{ armed, servedAt }`
- [ ] T012 [US1] Admin store (admin/slices/agent/peer/stores/peer.ts): hold
      `stateByAgent`, load with the tab, re-load after connect/remove/restart
- [ ] T013 [US1] Tab.vue (admin/slices/agent/peer/components/peer/Tab.vue): header
      shows **armed** / **pending restart** chip from `peersState`; restart banner
      becomes actionable — **Restart now** button wired to the existing agent-store
      restart action (in-flight state respected); banner and chip refresh when state
      flips
- [ ] T014 [US1] `cd admin && bun run typecheck` green

**Checkpoint**: US1 demo — connect a peer, chip says pending, Restart now, chip says
armed, domain question delegates (quickstart §4.3 + §5)

---

## Phase 4: User Story 2 — import an external agent by link (P2)

**Goal**: connect any A2A-1.0 agent by URL with optional credential;
replace-on-reimport; identical feed/step (FR-002…005, 009, 010).

**Independent Test**: quickstart §3 (mock external agent over curl) + §4.2/4.4/4.5
(console flow).

### Tests for User Story 2

- [ ] T015 [P] [US2] Extend api/src/slices/agent/peer/domain/peer.service.spec.ts:
      canonicalization (base and `.well-known` forms → one stored base); re-import of
      same canonical URL updates in place (same row id, no insert); own-installation
      URL → `PEER_SELF_URL`; fetch/version failure persists nothing; internal path
      unchanged
- [ ] T016 [P] [US2] Extend api/src/slices/agent/peer/domain/a2a.client.spec.ts: no
      `Authorization` header without a token; external 401/403 →
      `PEER_UNAUTHORIZED`; version check unchanged
- [ ] T017 [P] [US2] Extend api/src/slices/agent/peer/domain/delegation.service.spec.ts:
      credential picked by origin (pair `token` internal, `outboundToken` external);
      delegation row for external peer has `peerAgentId:null`, `peerId` set
- [ ] T018 [P] [US2] DTO specs (api/src/slices/agent/peer/dtos): ConnectPeerDto one-of
      (`peerAgentId` xor `url`, else `PEER_BODY`); AgentPeerDto poisoned-stub extends
      to `outboundToken`; delegation DTO tolerates null `peerAgentId`

### Implementation for User Story 2

- [ ] T019 [US2] dtos/connectPeer.dto.ts: one-of body `{ peerAgentId } | { url,
      token? }` with class-validator cross-field check (`PEER_BODY` on both/neither)
- [ ] T020 [US2] domain/a2a.client.ts: token parameter optional on
      `fetchCard`/`sendMessage`; map foreign 401/403 to `PEER_UNAUTHORIZED`
- [ ] T021 [US2] domain/peer.service.ts: `connectByUrl(agentId, url, token?)` —
      canonicalize (accept both forms, store base), refuse own A2A base
      (`PEER_SELF_URL` + hint), fetch card first, then upsert by `(agentId,
      canonicalUrl)` (update in place on re-import); extend `refresh` (external →
      re-read with `outboundToken`, 401 surfaces as cause) and `remove` (drop
      credential); error codes `PEER_URL_INVALID` / `PEER_URL_UNREACHABLE` /
      `PEER_VERSION` / `PEER_SELF_URL` in domain/peer.types.ts
- [ ] T022 [US2] peer.controller.ts: route the one-of body; re-import returns 200 with
      the updated row (contracts/peers-v2-api.md); delegations DTO field
      `peerAgentId` nullable
- [ ] T023 [US2] domain/delegation.service.ts: pick outbound credential by origin;
      record `peerAgentId:null` for external
- [ ] T024 [US2] Regenerate clients (api swagger → `cd admin && bun run build:api`)
- [ ] T025 [US2] Admin types/store/gateway (admin/slices/agent/peer/…): `origin` on
      `IAgentPeer`, `importByUrl(agentId, url, token?)`, delegation `peerAgentId`
      nullable; **feed filter keys switch from peer agent id to connection id**
      (Tab.vue peerFilter, Delegations.vue match, Row.vue emit)
- [ ] T026 [US2] Picker.vue: second path in the dialog — "By URL" input + optional
      credential field, preview via the fetched card before Connect, error causes
      surfaced; internal list path untouched
- [ ] T027 [P] [US2] Row.vue: external badge (origin) instead of live status; no
      `/agents/…` link for external rows
- [ ] T028 [P] [US2] Delegations.vue: external marker on feed rows; peer-name link
      only when `peerAgentId` present
- [ ] T029 [US2] `cd admin && bun run typecheck` green

**Checkpoint**: quickstart §3 end-to-end against the mock agent; re-import never
duplicates; credential nowhere in responses

---

## Phase 5: User Story 3 — the tab is called A2A (P3)

**Goal**: tab label **and key** become `a2a` (R5 amended); old `?tab=peers` links
still land (SC-007).

**Independent Test**: quickstart §4.1.

### Implementation for User Story 3

- [ ] T030 [US3] sections.ts (admin/slices/agent/agent/components/agent/workspace/):
      tab entry → `value: 'a2a'`, `title: 'A2A'`, desc updated; `SectionCountKey`
      member `'peers'` → `'a2a'`; update the file's URL-contract header comment
- [ ] T031 [US3] Legacy alias: at the single point the workspace reads `?tab=`
      (admin/slices/agent/agent/components/agent/workspace/Main.vue or its page),
      normalize `peers` → `a2a` before matching sections
- [ ] T032 [US3] Sweep count/section wiring for the renamed key (grep `'peers'` under
      admin/slices/agent/agent/ — counts provider, Rail.vue if it names the key) and
      update; tab content components stay in the `peer` slice unrenamed
- [ ] T033 [US3] `cd admin && bun run typecheck` green; manual: open `…?tab=peers`
      link → lands on the A2A tab

**Checkpoint**: all three stories independently demoable

---

## Phase 6: Polish & Cross-Cutting

- [ ] T034 [P] Docs: README peer/A2A section — external import, armed/pending, tab
      rename; note the `?tab=peers` alias
- [ ] T035 Full gates: `cd api && bun run test` (all), `bunx tsc --noEmit`, both
      console typechecks, lint pass on touched slice files
- [ ] T036 Quickstart §1–§4 full local run (mock script stays in scratchpad)
- [ ] T037 Live validation, quickstart §5–§6 on ranch.cleanslice.org: give Skyhunter a
      described card, `peers/state` before/after Restart now, re-ask "сколько crews в
      skyhunter", record before/after on CLEAN-95
- [ ] T038 Update specs/014-a2a-protocol-upgrade/checklists/requirements.md status and
      close out tasks.md marks

---

## Dependencies & Execution Order

- **Phase 2 blocks everything** (schema/types/mapper/gateway).
- **US1 (Phase 3)**: independent of US2/US3. MVP — measured by SC-001/002/005.
- **US2 (Phase 4)**: depends on Phase 2 only; touches the same admin components as US1
  (Tab.vue) — rebase order: land US1's Tab.vue changes first or coordinate edits.
- **US3 (Phase 5)**: independent; one registry file + alias, safe any time after T001.
- **Polish (Phase 6)**: after the stories you intend to ship; T037 needs a deploy.

### Parallel opportunities

- T006 ∥ T007 (different spec files); T015–T018 all ∥ (four files).
- T027 ∥ T028 after T025.
- US3 (T030–T033) can run fully parallel to US1/US2 by a second implementer — only
  T032's grep may brush counts wiring shared with Tab.vue.

## Parallel Example: User Story 2

```bash
Task: "T015 peer.service.spec — canonicalize/upsert/self-url"
Task: "T016 a2a.client.spec — optional bearer"
Task: "T017 delegation.service.spec — credential by origin"
Task: "T018 DTO specs — one-of + poisoned outboundToken"
# then T019–T023 sequentially (same service/controller files), then T024 → T025 → T026–T028
```

## Implementation Strategy

MVP = Phase 1 + 2 + US1, then **stop and validate** with quickstart §5 — SC-001/002
are the reason this feature exists (production baseline: zero delegations). Ship US2
next (external import is the protocol's second half), US3 last (pure copy/key change).
Commit per phase with `feat(peer): … (CLEAN-95)` / `feat(admin): … (CLEAN-95)`; Jira
checkpoint comments (large task); PR stacked on `feat/CLEAN-94-add-peer-inline-info`.
