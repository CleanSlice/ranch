# A2A and peers

An agent can hand work to another agent. Nothing is copied between them: each
keeps its own runtime, tools and knowledge. What travels is a **card** — the
agent-to-agent equivalent of a business card, saying who an agent is and what
it can do. Connect a card to an agent and it gains a colleague it can ask.

The mental model: **MCP is the tools in an agent's hands; A2A is the
colleagues at the next desk.** Copying an agent is a different feature —
that is templates.

- **The card** is derived, never written by hand: an agent's name and
  description, its template's skills, and the knowledge bases bound to it.
  Edit any of those and the card follows. It is served at the A2A standard
  path, `/a2a/agents/<id>/.well-known/agent-card.json`, and needs a
  credential — there is no anonymous discovery.
- **Connecting a peer** happens in the admin console, on an agent's **A2A**
  tab (formerly Peers — old `?tab=peers` links still land). Pick another
  agent of this ranch, or **import an external A2A agent by its address** —
  paste the URL, read its card, optionally give the access credential it
  expects, confirm. Re-importing the same address updates the entry in place.
  Connections are one-way: connecting B to A says nothing about what B may
  ask of A.
- **Delegating** is a tool the API serves to the runtime, so no agent image
  changes. A pod reads its tool list once at boot, so a new peer needs a
  restart — the tab shows **armed / pending restart** and the banner carries
  a one-click **Restart now**. The tool also carries the delegation policy:
  an agent that cannot answer must try a plausible peer before saying
  "I don't know".
- **Watching it happen**: a delegation appears in the chat's thinking
  timeline while it runs, naming the peer, what its card promised, why it was
  chosen and how long the wait is. Past delegations are listed on the A2A
  tab; external peers are marked in both places.
- **Limits**: a chain may be three hops long; an agent already in a chain
  refuses to re-enter it. External addresses must be publicly reachable —
  private hosts are refused (`A2A_ALLOW_PRIVATE_PEERS=true` lifts that for
  local development).

Set `PUBLIC_API_URL` to the origin other agents reach this API on — every
card URL is built from it. See `specs/013-a2a-agent-peers/` and
`specs/014-a2a-protocol-upgrade/` for the full specifications.
