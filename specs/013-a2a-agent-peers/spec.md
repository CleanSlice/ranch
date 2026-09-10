# Feature Specification: Agent-to-agent (A2A) — agent cards, peer agents, and delegation you can see

**Feature Branch**: `feat/CLEAN-74-a2a-agent-peers`

**Created**: 2026-09-10

**Status**: Draft — decisions settled in the discussion that preceded this spec; ready for `/speckit-plan`

**Tracker**: [CLEAN-74](https://dreamvention.atlassian.net/browse/CLEAN-74) — `[ADMIN]`, labels `admin`, `api`

**Input**: User description: "В ранче поддержку протокола agent to agent. В агенте карточка - что может делать и тд. Передаю карточку, теперь я могу давать эти задачи ему. Карточку генерим и подключаем. Потом демка: два агента - передаём карточку, фиксируем знания" — refined in discussion: "фиксируем знания" means the connecting agent remembers only the peer's card, not its knowledge ("чтобы не заставлять агента А знать и делать то, что может Б"); Ranch-to-Ranch inside one installation; peers are managed in the admin console; and the delegation must be visible in the chat's thinking area ("там где shimmer") as a step showing which agent was chosen, what its card says, and why it was chosen — "чтобы поддерживать высокий UX".

## Overview

Today a Ranch agent is an island. It can use tools (MCP servers, knowledge bases, browser) but it cannot ask another agent to do something. When two agents each hold part of what a user needs, the operator has to either merge them into one over-loaded agent or manually shuttle answers between two chats.

This feature gives agents **colleagues, not clones**. Nothing is copied or moved between agents: each agent keeps its own runtime, tools and knowledge. Instead, every Ranch agent gets an **agent card** — its business card: who it is, what it can do, where to reach it. An operator **connects** another agent's card to an agent, and from then on that agent can **delegate** a task to the peer the way a person hands work to a colleague whose card they hold. The result comes back and is used in the answer.

The mental model to explain it with: *MCP is the tools in the agent's hands; A2A is the colleagues at the next desk.* Copying an agent already exists in Ranch as templates and template install — that is a different feature and is not touched here.

The visible half matters as much as the protocol half. When an agent delegates, the person watching the chat must see it happen in the thinking timeline: a step naming the peer, what its card promised, the reason the agent picked it, and how long the wait took. A delegation that happens silently is a bug, not a shortcut.

**In scope**: cards for every agent; a peers list per agent in the admin console (pick, preview, connect, refresh, remove); the ability of an agent to delegate to a connected peer during a chat turn; the delegation step in the thinking timeline; loop and depth protection; explicit failure when a peer cannot answer; a demo scenario that proves it end-to-end.

**Out of scope, deliberately**: peers outside this Ranch installation (entering a foreign card URL by hand); streaming of the peer's partial answer back into the caller; writing the peer's answers into the caller's knowledge bases; any peers surface in the user (`app`) console; changing the agent runtime image.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every agent has a card that says what it can do (Priority: P1)

An operator opens an agent in the admin console and finds its **agent card**: the agent's name, a description, the list of things it can do (its skills), and the address another agent would use to reach it. The card is not written by hand — it is derived from what the agent already is: its name, its description, the skills of its template, and the knowledge bases bound to it. When any of those change, the card changes with them. The same card is available at a standard, well-known address for that agent, so any A2A-aware client with the right credential could discover it the same way.

**Why this priority**: The card is the unit everything else exchanges. Without a card there is nothing to connect and nothing for the delegating agent to reason about. It is also independently valuable: it is the first honest one-screen summary of "what is this agent for".

**Independent Test**: Open any agent, view its card, compare it with the agent's settings (name, description, template skills, bound knowledge bases). Change the description or bind another knowledge base; reopen the card and confirm it reflects the change. Request the card at its well-known address with a valid credential and get the same content.

**Acceptance Scenarios**:

1. **Given** an agent with a template that has two skills and one bound knowledge base, **When** the operator views its card, **Then** the card lists the agent's name and description, one skill per template skill, and the knowledge base as a further skill ("can answer questions about «base name»"), each with a short description usable by another agent to decide when to call.
2. **Given** the card is open, **When** the operator changes the agent's description or binds/unbinds a knowledge base, **Then** the card shows the new content the next time it is viewed, with no manual "regenerate" step.
3. **Given** an A2A-aware client holding a valid peer credential for the agent, **When** it requests the card at the agent's well-known address, **Then** it receives the same card, including the address to send tasks to and the credential scheme it must use.
4. **Given** a request for the card with no credential, **When** it arrives, **Then** it is refused; anonymous discovery is not offered in this feature.

---

### User Story 2 - Connect a peer: hand agent A the card of agent B (Priority: P1)

On agent A's page the operator opens **Peers**, chooses agent B from the agents of this installation, and sees B's card before confirming: name, description, skills. On confirm, B becomes a peer of A. The list shows every peer with the skills it advertises and when its card was last read. The operator can **refresh** a peer's card (re-read it) and **remove** a peer. Connections are directed — connecting B to A does not make A a peer of B — and an agent can have any number of peers.

**Why this priority**: This is the "передаю карточку" step from the request and the only way delegation gets authorised. It is the main admin work of the feature.

**Independent Test**: On agent A, connect agent B; confirm B appears in A's peers with its skills. Open agent B and confirm A is *not* listed there. Change B's description, press refresh on A's peer entry and see the new description. Remove B and confirm A's peers list is empty and B's card is no longer reachable with the credential that was issued for that connection.

**Acceptance Scenarios**:

1. **Given** agent A open on Peers, **When** the operator picks agent B from the list of the installation's agents, **Then** B's card is fetched and shown for review (name, description, skills) before anything is saved.
2. **Given** the review of B's card, **When** the operator confirms, **Then** B is saved as a peer of A together with a snapshot of the card as read at that moment and a credential that lets A reach B; the list shows B with its skills and the time of the snapshot.
3. **Given** B is a peer of A, **When** the operator opens B's Peers, **Then** A is not listed — the connection is one-way.
4. **Given** B's card changed since it was connected, **When** the operator presses refresh on the entry, **Then** the snapshot is replaced with the current card and the snapshot time updates; until refresh, A keeps working from the old snapshot.
5. **Given** B is a peer of A, **When** the operator removes it, **Then** A can no longer delegate to B and the credential issued for that connection stops working.
6. **Given** the picker, **When** the operator looks for A itself in the list, **Then** an agent cannot be connected as its own peer, and an agent already connected is shown as connected rather than offered again.
7. **Given** an agent that was connected as a peer is deleted from the installation, **When** the operator views the peers list of any agent that held it, **Then** the entry is marked as gone and can be removed; delegation to it is refused with a clear reason.

---

### User Story 3 - Agent A delegates to peer B and answers with the result (Priority: P1)

A person chats with agent A and asks something that A cannot do but B, a connected peer, can. A recognises from B's card that B is the right colleague, sends B the task, waits for the answer, and replies to the person using B's result, saying that the answer came from B. A never gets B's tools, files, or knowledge — only B's answer. If B cannot be reached or fails, A says so plainly instead of quietly answering from its own guesswork.

**Why this priority**: This is the point of the feature — "теперь я могу давать эти задачи ему". Stories 1 and 2 exist to make this possible.

**Independent Test**: Give B a knowledge base about a topic A knows nothing about. Connect B to A. Ask A a question from that topic and confirm A's answer contains the fact and attributes it to B. Stop B and ask again; confirm A reports that B was unavailable rather than inventing an answer.

**Acceptance Scenarios**:

1. **Given** B (with a bound knowledge base on topic X) is a peer of A and the person asks A about topic X, **When** A works on the reply, **Then** A sends the question to B, receives B's answer with its citations, and replies to the person with that answer while stating that it came from B.
2. **Given** A has three peers with distinct skills, **When** the person asks about a topic that only one peer covers, **Then** A delegates to that peer and not to the others.
3. **Given** the person's request contains two independent questions that two different peers cover, **When** A works on the reply, **Then** A may ask both peers in the same turn and combine their answers.
4. **Given** B is not running or does not answer within the platform's reply limit, **When** A delegates to it, **Then** A receives an explicit failure naming the peer and the cause, and A's reply to the person says that B could not be reached.
5. **Given** B answers with a question of its own (it needs clarification), **When** the answer reaches A, **Then** A treats it as B's reply — it may relay the question to the person or answer it and ask B again in the same turn, continuing the same conversation with B.
6. **Given** the person asks A something A can do itself, **When** A works on the reply, **Then** A answers itself without delegating; peers are for what A cannot do, not a default hop.

---

### User Story 4 - The person watching sees the delegation happen (Priority: P1)

While A is thinking, the chat's thinking timeline — the same place today's "thinking" shimmer and steps live — gains a **delegation step** the moment A decides to ask a peer. The step names the peer, shows what its card promised that made it the choice, A's own one-line reason for choosing it, a live status (asking → waiting → answered / failed) and the elapsed time. When the answer arrives, the step completes and the result feeds the rest of the turn. After the turn ends, the collapsed thinking summary still lists that a delegation took place, and expanding it shows the step again.

**Why this priority**: The user called this out as an important part of the feature's UX. A delegation that cannot be seen is indistinguishable from a slow answer, and the reason for choosing a peer is the only way an operator can judge whether the cards are written well.

**Independent Test**: Trigger a delegation from Story 3 while watching the chat. Confirm the delegation step appears before the answer, shows peer name, card summary, reason, and a running wait, then finishes. Trigger a failed delegation and confirm the same step ends in a failed state with the cause.

**Acceptance Scenarios**:

1. **Given** A decides to delegate to B, **When** the decision is made, **Then** within a second a step appears in A's thinking timeline reading "Asking «B»" with B's card summary (the skills that matched), A's reason for choosing B, and a status of "waiting".
2. **Given** the step is waiting, **When** the wait continues, **Then** the elapsed time is visible and the thinking indicator keeps animating; there is no period where the chat looks idle.
3. **Given** B answers, **When** the answer arrives, **Then** the step switches to "answered" with the total time and a short excerpt of what came back, and A's reply follows below.
4. **Given** B fails or times out, **When** the failure arrives, **Then** the step switches to "failed" with the cause in product wording, not raw error text.
5. **Given** the turn is complete, **When** the person expands the collapsed thinking summary, **Then** the delegation step is still there with the same content.
6. **Given** a chat surface that already renders thinking steps but has no special delegation rendering, **When** a delegation happens, **Then** it still shows as an ordinary named step with its detail — the delegation step degrades gracefully.

---

### User Story 5 - Delegation cannot run away (Priority: P2)

Agents delegating to each other must not loop or fan out without bound. If A delegates to B and B would delegate back to A for the same request, B refuses that hop. Chains deeper than a small fixed depth are refused. Every delegation is recorded on the caller's side so that an operator can see who asked whom, when, and how long it took.

**Why this priority**: Needed before more than a demo pair of agents is connected; the demo itself works without it, so it follows the P1 stories.

**Independent Test**: Connect A→B and B→A. Ask A something that makes it call B, and give B a card that tempts it to call A back. Confirm the second hop is refused and B answers on its own. Connect a chain A→B→C→D→E and confirm the hop beyond the depth limit is refused with a clear reason.

**Acceptance Scenarios**:

1. **Given** A→B and B→A are both connected, **When** A delegates to B for a request and B tries to delegate the same request back to A, **Then** B's attempt is refused with a "would loop" reason and B answers without A.
2. **Given** a chain of peers, **When** a delegation would exceed a depth of 3 hops from the original chat, **Then** it is refused with a "too deep" reason and the last agent answers on its own.
3. **Given** any delegation, **When** it completes or fails, **Then** the caller's records show the peer, the moment it started, the duration, and the outcome, so an operator can audit delegation without reading chat text.

---

### User Story 6 - The demo: two agents, one card, one question (Priority: P2)

A repeatable walkthrough the team can run in front of an audience in under five minutes: create agent B with a knowledge base on a topic, create agent A without it, show A cannot answer, connect B's card to A, ask again, watch the delegation step, and get the answer with B's citation.

**Why this priority**: The request names the demo explicitly ("потом демка"). It is the acceptance test of the whole feature, but it delivers nothing on its own.

**Independent Test**: Follow the walkthrough on a fresh installation and confirm every step behaves as described without improvisation.

**Acceptance Scenarios**:

1. **Given** A without peers and a question on topic X, **When** asked, **Then** A says it does not know (no delegation step appears).
2. **Given** B connected as A's peer, **When** the same question is asked, **Then** the delegation step appears, and A answers with B's content and citation.
3. **Given** the demo is run twice on the same installation, **When** the second run starts, **Then** nothing from the first run has to be undone by hand beyond removing the peer.

---

### Edge Cases

- The peer exists but is not deployed or is restarting: its card is still readable (the card describes the agent, not its uptime), but delegation fails fast with "peer not running", not after the full reply limit.
- The peer's reply limit: a delegation waits at most as long as the platform's synchronous reply limit (today two minutes); a longer job ends in a "timed out" failure that A reports.
- Card snapshot drift: A works from the snapshot taken at connect or last refresh, never from a live read, so a peer editing its description mid-turn does not change A's behaviour until refresh.
- Two peers whose cards read the same: the platform does not block it, but the peers list warns that the two descriptions are indistinguishable, because A will choose between them by chance.
- A peer with no skills at all (no template skills, no knowledge bases): its card is still valid with an empty skills list, and the connect review says so; the operator can still connect it.
- The credential issued at connect is per connection: removing the peer revokes it; re-connecting issues a new one; a credential from one connection cannot be used to reach another agent.
- Self-connection and duplicate connection are refused at the picker and again at save.
- The person's message to A contains attachments: they are not forwarded to the peer in this feature; A sends the peer a text task it composed, and the delegation step shows that text.
- Delegation inside a public share-link chat or the embed: behaves exactly as in the admin chat, but the delegation step renders with the surface's existing generic step styling (Story 4, scenario 6).
- A's own card lists nothing about its peers: having colleagues is not a skill, and advertising them would invite chains.
- Concurrent delegations from one turn: allowed; each has its own step and its own time; loop and depth checks apply to each independently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every agent MUST have an agent card derived from its current state: name, description, one skill per skill of its template, and one skill per bound knowledge base. The card MUST include the address for sending tasks and the credential scheme required. It MUST reflect changes to the underlying agent on the next read with no manual regeneration.
- **FR-002**: The card MUST be readable at a standard well-known address for that agent by any client presenting a valid credential for it (an operator session, or a peer credential issued for that agent). Requests with no valid credential MUST be refused.
- **FR-003**: The admin console MUST show an agent's card on the agent's page in the same terms another agent would read it (name, description, skills, address).
- **FR-004**: The admin console MUST let an operator connect another agent of the same installation as a peer: choose from a list, preview the fetched card, confirm. The list MUST exclude the agent itself and mark agents already connected.
- **FR-005**: A peer connection MUST be directed (A→B does not imply B→A), MUST allow any number of peers per agent, and MUST store a snapshot of the peer's card and the time it was read.
- **FR-006**: The operator MUST be able to refresh a peer's card snapshot and to remove a peer. Removing a peer MUST revoke the credential issued for that connection.
- **FR-007**: Connecting a peer MUST issue a credential scoped to exactly that (caller, peer) pair; the peer MUST accept tasks only from callers presenting a credential issued for it.
- **FR-008**: During a chat turn, an agent MUST be able to delegate a text task to any of its connected peers and receive the peer's reply, including the peer's citations when the peer provides them. The delegating agent MUST NOT gain access to the peer's tools, files or knowledge bases — only to its reply.
- **FR-009**: The delegating agent MUST be given, at the start of each turn, the list of its peers with the skills and descriptions from their card snapshots, so that it can decide when and whom to ask without an extra lookup.
- **FR-010**: A delegation MUST be able to continue a conversation with the same peer within the same turn (the peer's follow-up question answered and re-sent), and MUST start a fresh conversation with the peer in a new turn.
- **FR-011**: When a peer is not running, refuses the task, fails, or does not reply within the platform's synchronous reply limit, the delegating agent MUST receive an explicit failure naming the peer and the cause, and MUST NOT be able to mistake it for an answer.
- **FR-012**: Every delegation request MUST carry the chain of agents already involved in the current person's request. A peer MUST refuse a task that would place an agent already in the chain back into it, or that would make the chain longer than 3 hops, and the refusal MUST state which rule applied.
- **FR-013**: Each delegation MUST appear in the caller's thinking timeline as a step, emitted when the decision to delegate is made, carrying: the peer's name, the card content that matched (skills), the caller's one-line reason for the choice, the task text sent, a status that moves through waiting → answered or failed, and the elapsed time. On completion the step MUST carry a short excerpt of the reply or the failure cause in product wording.
- **FR-014**: The delegation step MUST travel through the existing thinking-step mechanism so that every chat surface that renders thinking steps shows it; the admin chat MUST render it with the dedicated delegation layout (peer, card summary, reason, status, time).
- **FR-015**: After a turn completes, the delegation step MUST remain visible inside the turn's collapsed thinking summary and when re-expanded, for as long as that turn's thinking steps are kept today.
- **FR-016**: Each delegation MUST be recorded on the caller's side with peer, start time, duration and outcome, so an operator can audit delegations without reading chat text.
- **FR-017**: Delegation MUST NOT be offered by default: an agent with no connected peers MUST behave exactly as it does today, with no delegation tool, step, or wording appearing anywhere.
- **FR-018**: The agent runtime image MUST NOT need to change for delegation to work; the capability MUST be provided through the tools the platform already serves to agents.
- **FR-019**: The card MUST NOT list the agent's peers.

### Key Entities

- **Agent card**: the public description of one agent as read by another agent — name, description, skills (each with a name and a description that says when to ask), task address, credential scheme. Derived, not stored; a **card snapshot** is the copy a peer connection keeps.
- **Peer connection**: a directed link from a caller agent to a peer agent: the snapshot of the peer's card, when it was read, the credential issued for this pair, and a "gone" marker when the peer no longer exists.
- **Delegation**: one task handed from a caller to a peer during one chat turn: the task text, the chain of agents so far, the peer's reply or the failure, start time and duration. May continue as a conversation with the peer within the same turn.
- **Delegation step**: the entry in the caller's thinking timeline that represents a delegation to the person watching: peer, matched card content, reason, task text, status, elapsed time, excerpt or cause.
- **Peer credential**: the proof a caller presents to a peer; issued at connect, scoped to one (caller, peer) pair, revoked at removal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can go from "agent B exists" to "B is a peer of A with a reviewed card" in under one minute and at most three interactions (open Peers, pick B, confirm).
- **SC-002**: In the demo scenario, 100% of runs produce an answer from A that contains B's fact and names B as the source; 0% of runs produce that fact from A without a delegation step.
- **SC-003**: The delegation step appears in the chat within one second of the agent deciding to delegate, and there is no moment during the wait when the chat shows no activity indication.
- **SC-004**: When the peer is stopped, 100% of delegations end in an explicit "peer unavailable" outcome that is visible both in the thinking step and in A's reply; 0% of such turns produce a fabricated answer presented as coming from the peer.
- **SC-005**: With three peers holding clearly distinct cards, A picks the right peer for a topic that only one of them covers in at least 9 of 10 test questions.
- **SC-006**: With A→B and B→A connected, 100% of attempted back-hops are refused, and no request ever involves more than 3 agents beyond the one the person is talking to.
- **SC-007**: An agent with no peers shows no behavioural or visual difference from before this feature in its existing acceptance scenarios (no regressions).
- **SC-008**: A person shown a delegation step for the first time can state, without help, which agent was asked and why, in at least 4 of 5 hallway tests.

## Assumptions

- **Protocol shape**: the exchange between agents follows the A2A protocol's shapes — a card at a well-known address, tasks sent as messages with a task status and a reply — so that a second Ranch installation, or a foreign A2A agent, later needs only a credential arrangement, not a redesign. Planning decides how much of the protocol surface (task states, streaming) is honoured beyond the synchronous request-and-reply used here.
- **Where the client lives**: the delegating side is a tool the platform serves to the agent runtime through the tool channel it already uses (the same way knowledge search is served), whose description lists the agent's peers. This is why the runtime image does not change.
- **Card skills**: template skills become card skills as-is; a bound knowledge base becomes a card skill named after the base with the base's description; an agent's description is the card's description. No separate hand-edited card text in this feature.
- **Credential scheme**: a platform-issued, per-connection secret presented as a bearer credential; operators never see or type it. Anonymous card discovery is off.
- **Reply limit**: delegations are bounded by the platform's existing synchronous chat reply limit (two minutes today). Longer peer jobs are a later feature.
- **Depth limit**: 3 hops beyond the agent the person is talking to. Chosen as the smallest number that still allows A→B→C.
- **"Фиксируем знания"** means the caller remembers the peer's card and nothing else; peer replies are not written into any knowledge base.
- **Surfaces**: the peers list and the card view live in the admin console on the agent's page; the user console is unchanged except that its chat, if it renders thinking steps, shows the delegation step in its generic style.
- **Persistence of the step**: delegation steps live as long as today's thinking steps do; making them part of the durable transcript is not required here, but the delegation record (FR-016) is durable.
- **Same installation only**: the picker lists this installation's agents; the address stored in a snapshot is nonetheless a full address, so nothing in the data model assumes locality.
