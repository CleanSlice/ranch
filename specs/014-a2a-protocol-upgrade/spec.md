# Feature Specification: A2A v2 — external agents and delegation that fires

**Feature Branch**: `014-a2a-protocol-upgrade` (git: `feat/CLEAN-95-a2a-protocol-upgrade`, Jira: CLEAN-95)

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Комплексная таска по импруву a2a протокола: он сейчас костыльно работает и не в полном объёме. (1) в табах переименовать Peers → A2A; (2) реализовать корректный импорт внешних агентов по ссылке, замещение их; (3) агент не делегирует задачи, а пытается решить их сам (прод: Rancher + Skyhunter). Валидация на https://admin.ranch.cleanslice.org (креды RANCH_PLATFORM_LOGIN / RANCH_PLATFORM_PASS в `.env`)."

## Evidence from production *(context, verified 2026-09-16)*

On ranch.cleanslice.org, Rancher has exactly one peer — Skyhunter, `running` — and the
delegation feed is empty: **not one delegation has ever fired**. Skyhunter's stored card
advertises **zero skills** and the description "basic agent". Asked "сколько crews в
skyhunter", Rancher answers "I don't know, I have no tool to look at Skyhunter's config"
and offers its own platform tool (`Ranch__get_agent`) instead of asking the peer. Three
compounding causes are in scope here: the ask tool may not be loaded by the running pod
(restart-to-apply trap), the card gives the model nothing to match a question against,
and the caller's own tools win by default when the card is silent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A connected peer actually gets asked (Priority: P1)

An operator connects agent B as a peer of agent A and asks A a question that belongs to
B — B's domain by card, or B named outright ("спроси у B…", "сколько crews в B"). A
delegates the task to B over A2A, the thinking timeline shows the delegation step, and
A's reply carries B's answer with attribution — instead of "I don't know" or a guess
from A's own tools.

**Why this priority**: This is the product's core promise; today it fires zero times in
production. Everything else on this spec is scaffolding around this behaviour.

**Independent Test**: On a stack with two agents, connect B to A with a card that names
B's domain, ask A a domain question and a "спроси у B" question; both must produce a
delegation row and an attributed answer.

**Acceptance Scenarios**:

1. **Given** A has peer B whose card carries a description and at least one skill,
   **When** the operator asks A a question inside B's advertised domain that A cannot
   answer from its own knowledge, **Then** A delegates to B, the delegation step is
   visible, and the reply names B as the source.
2. **Given** A has peer B, **When** the operator explicitly directs the question at B
   ("ask B…", a question about B's own data), **Then** A delegates to B — or states in
   one sentence why it could not (peer not running, refused) — and never silently
   substitutes an answer from its own tools. [NEEDS CLARIFICATION: Q2 — how strong
   should the prefer-the-peer policy be when A believes it can answer itself?]
3. **Given** the operator has just connected B to A, **When** the connect completes,
   **Then** the system makes the remaining step to "armed" explicit and one-click
   (see FR-008), and the A2A tab shows whether the running agent has actually loaded
   the peer. [NEEDS CLARIFICATION: Q3 — is one-click restart acceptable, or must a
   new peer arm without any restart?]
4. **Given** B's card advertises nothing, **When** the operator looks at the A2A tab,
   **Then** the existing "advertises nothing" warning explains that delegation will not
   trigger on topic matching — and the ask tool still lists B by name and description so
   explicit "ask B" requests can fire.

---

### User Story 2 - Import an external agent by link (Priority: P2)

An operator pastes the A2A address of an agent living **outside this Ranch
installation** (another Ranch, or any A2A-compliant framework) into the Add peer flow.
The platform fetches the external agent's card, shows the same preview an internal
candidate gets, accepts an optional access credential for that agent, and connects it as
a peer. Importing the same address again replaces the stored entry instead of creating a
duplicate. [NEEDS CLARIFICATION: Q1 — does "замещение" mean anything beyond
replace-on-reimport?]

**Why this priority**: The A2A address exists precisely so agents outside the
installation can be reached; today the picker only accepts internal agents, so the
protocol runs at half its purpose.

**Independent Test**: Import a reachable external A2A agent by URL, delegate to it, see
the delegation row; re-import the same URL and confirm the entry was updated, not
duplicated.

**Acceptance Scenarios**:

1. **Given** the operator has an external agent's card URL, **When** they paste it into
   the Add peer flow, **Then** the platform reads the card, shows name / description /
   skills before anything is saved, and connects on confirm.
2. **Given** the external agent requires an access credential, **When** the operator
   provides it at import time, **Then** delegations authenticate with it and the
   credential is never displayed back anywhere in the console.
3. **Given** an external peer already exists, **When** the operator imports the same
   address again, **Then** the existing entry is updated in place (card, credential) —
   the peer list never shows two rows for one external agent.
4. **Given** an external peer, **When** the operator looks at the A2A tab, **Then** the
   entry is visibly marked as external (origin shown), and refresh / remove work exactly
   like for internal peers; remove also discards the stored credential.
5. **Given** an unreachable URL, a non-A2A response, or an unsupported protocol version,
   **When** the operator tries to import, **Then** the flow fails before saving anything,
   with a message naming the cause.

---

### User Story 3 - The tab is called A2A (Priority: P3)

The agent workspace tab currently labeled "Peers" is renamed to "A2A", since it now
holds the whole agent-to-agent surface: the agent's own card, peers (internal and
external), and the delegation feed.

**Why this priority**: Cheap clarity win; pure copy change with no behaviour attached.

**Independent Test**: Open any agent workspace and see the tab labeled "A2A" with all
existing content intact; no link or saved view breaks.

**Acceptance Scenarios**:

1. **Given** any agent workspace, **When** the operator looks at the tab bar, **Then**
   the tab reads "A2A" and opens the same content the Peers tab held.
2. **Given** a bookmarked or shared link to the old tab, **When** it is opened, **Then**
   it still lands on the renamed tab.

---

### Edge Cases

- External URL points at an agent of **this** installation: treated as internal —
  refused with a hint to pick it in the internal list (prevents credential duplication).
- External agent's card identity changes on re-import (different agent behind the same
  URL): flagged to the operator before replacing.
- External peer's credential expires: delegation fails with "credential refused" in the
  feed; refresh card shows the same cause instead of silently keeping a stale snapshot.
- Two peers (any origin) with near-identical descriptions: existing duplicate-description
  warning keeps applying to imported cards.
- External agent unreachable at delegation time: fail fast with cause, same as internal
  "peer not running" — never wait out the full timeout when the endpoint refuses.
- The peer answers with an empty or non-text artifact: recorded as answered with an
  explicit "empty answer" note, not as a crash.
- Question matches two peers' domains at once: the caller picks one and names it; the
  delegation row records which; never asks both in parallel in v1.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The agent workspace tab is labeled "A2A" everywhere the console shows it;
  existing links to the tab keep working. User-facing copy only — stored data and
  existing integrations keep their current terms.
- **FR-002**: The Add peer flow accepts an A2A address (agent base URL or its well-known
  card URL) in addition to picking an internal agent, validates protocol compatibility,
  and shows the standard card preview before anything is saved.
- **FR-003**: The import flow accepts an optional access credential for the external
  agent, stores it write-only (never returned to any console surface), uses it for card
  reads and delegations, and discards it when the peer is removed.
- **FR-004**: Importing an address that matches an existing external peer of the same
  agent updates that entry in place — card snapshot, address, credential. The peer list
  never holds two entries for one external agent.
- **FR-005**: External peers are visibly distinguished from internal ones in the A2A tab
  and in the delegation feed; refresh and remove behave identically for both origins.
- **FR-006**: The delegation tool presented to the calling agent describes every peer by
  name, description, and skills, for internal and external peers alike, so a domain
  question can be matched against the card text.
- **FR-007**: When a request explicitly names a peer or asks about that peer's own
  data/domain, the caller delegates to that peer; if delegation is impossible, the reply
  states the cause in one sentence. The caller never answers such requests from its own
  tools without saying why the peer was not asked.
- **FR-008**: After connecting or importing a peer, the path to "delegation armed" is
  explicit: the console shows whether the running agent has loaded the peer, and the
  remaining step (if any) is offered as a single click rather than a text instruction.
- **FR-009**: Delegations to external peers produce the same visible step and the same
  feed rows (outcome, duration, cause on failure) as internal ones.
- **FR-010**: Every failed delegation and failed import names its cause (unreachable,
  credential refused, protocol mismatch, peer not running, timeout); no silent failures
  and no full-timeout waits on connection-refused class errors.

### Key Entities

- **Peer connection (extended)**: an existing directed connection gains an **origin**
  (internal / external); external entries carry the imported address and an optional
  write-only access credential alongside the card snapshot and read timestamp.
- **Agent card (unchanged shape)**: the A2A card as read from either an internal agent
  or an external address; still shown verbatim to the operator before connecting.
- **Delegation record (unchanged shape)**: gains nothing — but must be produced
  identically for external peers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a stack reproducing the production pair (caller + one running peer
  whose card names its domain), a domain question asked in the caller's chat produces a
  delegated, attributed answer in at least 9 of 10 attempts; today's baseline is 0.
- **SC-002**: A request that names the peer outright produces either a delegation or a
  one-sentence explanation of why not, in 10 of 10 attempts; it is never answered by the
  caller's own tooling without that explanation.
- **SC-003**: An operator with an external agent's URL (and credential, when needed)
  connects it in at most 3 interactions from the A2A tab, and the preview they see
  before confirming matches what the delegating agent will read.
- **SC-004**: Re-importing the same external address never produces a second entry —
  100% of re-imports update in place.
- **SC-005**: An operator can tell from the A2A tab alone whether delegation is armed
  (peer loaded by the running agent) — verified by a usability walkthrough with no log
  reading and no documentation.
- **SC-006**: Zero delegation or import failures without a named cause across the
  validation run; connection-refused failures surface in under 5 seconds.
- **SC-007**: After the rename, no console surface still says "Peers" as the tab name,
  and every pre-existing link to the tab still resolves.

## Assumptions

- External agents speak A2A protocol version 1.0 and expose their card at the standard
  well-known location; agents that do not are rejected at import with a protocol-mismatch
  message (no compatibility shims in v1).
- External-agent authentication in v1 is a single static bearer-style credential pasted
  by the operator at import time; credential exchange flows / federation handshakes are
  out of scope.
- Cross-installation loop and depth protection continues to rely on the existing chain
  metadata when the external party is also a Ranch; foreign frameworks that strip the
  metadata are bounded by the existing chain-depth cap on our side.
- The rename is presentation-level; validation that no stored identifier changes is part
  of the work.
- Live validation runs against the production stack (admin.ranch.cleanslice.org, agent
  `agent-0db1552e-d8c7-49ac-8184-04ad64a9c55a`) with the platform credentials from the
  project's local `.env` (`RANCH_PLATFORM_LOGIN` / `RANCH_PLATFORM_PASS`; never printed
  or committed), plus a local two-agent stack for the delegation scenarios.
- The delegation-quality work (US1) may require changes on the runtime side (how the
  ask tool and card text reach the model); this spec constrains the outcome, not the
  split between repositories.
