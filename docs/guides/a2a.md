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

## Who a connection is for

A connection is not the agent's alone: who may see and use it depends on who
is asking (CLEAN-236).

- **A connection to an agent of this Ranch exists for a person only when
  that person has access to the colleague.** Somebody who does not is not
  shown it on the A2A tab, cannot remove or re-read it by its id, and the
  agent does not offer it in their turns. Every refusal reads exactly like
  the one for a connection that does not exist.
- **Open to visitors** is a switch on the connection, for somebody who
  manages both agents, and it asks to be confirmed. An open connection also
  serves everybody else who talks to the agent: people without access to the
  colleague, share and anonymous visitors. They are shown that *a colleague*
  was asked, never which one: no name, address, status or description, on
  the tab, in the chat's thinking timeline and in the list of delegations.
  Connections made before this feature kept working for everybody and are
  marked **needs review** until somebody decides.
- **Each hop is checked for the same person.** A question that travels
  A → B → C is checked at B against the person who started it at A. Power
  never travels with it: the agent that receives a question cannot be told
  by it to connect, remove or open anything.
- **Who connected it** is recorded and shown. The person who made a
  connection can remove it; otherwise that takes somebody who manages the
  agent and has access to the colleague.
- **From the chat**, a signed-in person can connect the agents they have
  access to, and nobody else can connect anything: a visitor uses the agent
  and does not configure it.
- **An agent outside this Ranch** that a User adds from the chat is theirs
  alone: the agent asks it in that person's turns only. One added by
  somebody who manages the agent is the agent's, for everybody. An address
  that belongs to one of this Ranch's own agents is refused however it is
  written, as is a card that sends its questions here: pick the agent from
  the list, where access is checked.

Rolling this out needs agents on runtime 0.36 or later, restarted, before
the API is upgraded: until then an agent treats a colleague's question as a
visitor's and an Admin as somebody who is not an administrator.

Set `PUBLIC_API_URL` to the origin other agents reach this API on — every
card URL is built from it. See `specs/013-a2a-agent-peers/`,
`specs/014-a2a-protocol-upgrade/` and `specs/033-identity-boundaries/` for
the full specifications.
