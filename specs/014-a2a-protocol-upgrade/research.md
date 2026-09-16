# Research: A2A v2 — external agents and delegation that fires

All Technical Context unknowns resolved. Decisions numbered R1–R7; each cites the code
that grounds it.

## R1 — External peers extend `AgentPeer`, not a new model

**Decision**: one row type for both origins. `peerAgentId` becomes nullable (FK kept for
internal rows), new columns: `origin` (`'internal' | 'external'`), `outboundToken
String?` (credential we present to the external agent, write-only), inbound pair
`token` becomes nullable (only internal rows mint one — an external agent never calls
us through this row). `cardUrl` keeps holding the address for both origins. Dedup for
external rows: unique `(agentId, canonical cardUrl)`.

**Rationale**: everything downstream — `ask_agent` description, the tree, the feed, the
mapper — iterates one list today (`peer.service.ts`, `askAgent.tool.ts`). A second model
would double every surface for zero user-visible gain, and the spec explicitly keeps
external peers behaviourally identical (FR-005, FR-009).

**Alternatives considered**: separate `ExternalPeer` model — rejected (two lists, two
feeds, two tool sections); storing externals as shadow `Agent` rows — rejected (leaks
foreign agents into every agent listing, exactly what Q1 scoped out).

## R2 — Import is the same connect endpoint with a one-of body

**Decision**: `POST /agents/:id/peers` accepts `{ peerAgentId }` (unchanged) **or**
`{ url, token? }`. The URL is canonicalized (accept both the agent base URL and its
`…/.well-known/agent-card.json` form; store the base), the card is fetched and
version-checked before anything persists (same order as `PeerService.connect` — the
card read is the proof the connection works). A URL whose canonical form matches this
installation's own A2A base (`API_PUBLIC_URL` + `/a2a/agents/`) is refused with
`PEER_SELF_URL` and a hint to pick the agent in the internal list. Re-import of an
existing `(agentId, canonical url)` **updates the row in place** — card snapshot,
address, credential — and returns the updated peer (FR-004, Q1 decision).

**Rationale**: one endpoint keeps the picker a single flow and the SDK surface small;
canonical-URL dedup is the only identity an external agent reliably has.

**Alternatives considered**: separate `POST /agents/:id/peers/import` — rejected, two
code paths for one outcome; card-`name` identity for dedup — rejected, names collide
and change; hard 409 on re-import — rejected by Q1 (замещение = replace).

## R3 — FR-011 lives in the `ask_agent` tool description

**Decision**: extend `BASE_DESCRIPTION` in `askAgent.tool.ts` with the give-up rule,
placed before the "not a first resort" caveat so the two read as one policy:

> Before you answer that you do not know, cannot help, or lack a tool: check your
> peers below. If any peer's description or skills plausibly covers the question, call
> this tool first — "I don't know" without having asked a matching peer is a wrong
> answer. When the user names a peer or asks about a peer's own data, always ask that
> peer.

Peer entries keep name + description + skills (`describePeer`). No runtime-repo
changes; no system-prompt injection; tool stays conditionally listed (absent with zero
peers).

**Rationale**: production baseline (2026-09-16: Rancher+Skyhunter, zero delegations)
shows the model reaching for its own platform tools and answering "I don't know". The
tool description is the only model-facing text this repo controls, it is re-served on
every `tools/list`, and CLEAN-74 already built dynamic descriptions for exactly this
purpose. The current text actively discourages use ("not a first resort") without the
counter-rule for the give-up path.

**Alternatives considered**: runtime system-prompt change — rejected here (crosses the
repo boundary the spec kept out of scope; revisit only if SC-001/002 fail live);
forcing tool choice — impossible over MCP; renaming the tool `delegate` — cosmetic, no
evidence it moves behaviour.

## R4 — Armed/pending is recorded where the tool list is served

**Decision**: when `AskAgentTool.isListedForRequest` / `describeForRequest` serve an
agent's peer list over MCP, persist on `Agent`: `peersServedAt DateTime?` and
`peersServedHash String?` — hash of the sorted current peer row ids. New console
endpoint `GET /agents/:id/peers/state` returns `{ armed, servedAt }` where `armed` =
stored hash equals the hash of the current peer set. Admin shows **armed** /
**pending restart** in the A2A tab header and turns the restart banner's text into a
banner with a **Restart now** button (existing restart action + in-flight machinery in
`agent` store).

**Rationale**: the serve point is the single place that knows what the pod actually
received; hashing row ids catches adds, removes and re-imports (updated row id
survives, but `updatedAt` bumps are irrelevant — the tool re-reads descriptions per
request; only membership needs the restart). Production's zero-delegation mystery
("did the pod ever load the tool?") becomes visible at a glance (SC-005).

**Alternatives considered**: comparing pod start time with peer `updatedAt` — rejected
(deleted rows leave no timestamp; serve-hash handles membership exactly); runtime
hot-reload — out of scope by Q3 decision.

## R5 — Rename is one registry line; the tab key survives

**Decision**: `admin/slices/agent/agent/components/agent/workspace/sections.ts:46`
`title: 'Peers'` → `title: 'A2A'`. The section key stays `peers`, so existing deep
links keep resolving (SC-007). Copy inside the tab already says "peer" as a concept —
kept; only the tab name changes (FR-001).

## R6 — External transport reuses the existing A2A client with an optional bearer

**Decision**: `A2aClient.fetchCard` / `sendMessage` make the token parameter optional —
no `Authorization` header when the external agent needs none; external rows pass
`outboundToken`, internal rows keep the pair `token`. `DelegationService` picks the
credential by `origin`. Chain metadata (`ranch.chain`) is sent unchanged; a foreign
server that ignores it is still bounded by our own depth cap on the way back in.

**Rationale**: the client already speaks exactly the JSON-RPC dialect our server
serves; the only real difference for a foreign endpoint is auth. Assumption from the
spec holds: v1 credential = single static bearer pasted at import.

## R7 — Failure causes extend the existing code table

**Decision**: import failures get first-class codes surfaced through the standard
envelope: `PEER_URL_INVALID`, `PEER_URL_UNREACHABLE`, `PEER_VERSION`,
`PEER_SELF_URL`. Delegation failures reuse the existing `PEER_*` causes; external
credential rejection maps onto the existing `PEER_UNAUTHORIZED` ("credential
refused") — the feed and `Delegations.vue` cause table need no new rows for it.
Connection-refused class errors keep the CLEAN-74 fail-fast behaviour (no full-timeout
waits — FR-010/SC-006).
