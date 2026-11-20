# A2A and agent access: what the model misses

**Date**: 2026-11-20 · **Ticket**: CLEAN-236 · Input to the spec, not part of it.

Read from the code of `api/src/slices/agent/peer`, the bridle hub and the
runtime at v0.35.0. "Prod" marks what was observed on the live installation;
everything else is from the code and was not exercised. Prod has no internal
connection today (`GET /agent-links` as the Owner returns none), so changing
the model migrates nothing.

Below, A is the agent that asks, B the colleague it asks.

## The root cause

A connection A→B is treated as part of A's configuration. Every rule asks one
question, "may this caller manage A?", and none asks "does this caller reach
B?". The one exception is the fleet map (`GET /agent-links`), which lists a
pair only when the caller reaches both ends, with the comment "a pair with one
hidden end would name the hidden agent". Everything else names it.

## Findings

### Seeing a hidden colleague

1. **Peers of A are shown whole to whoever manages A.** `GET
   /agents/:id/peers`, `list_agent_peers` (through the Ranch assistant) and
   `list_my_peers` (through A itself) return, for each colleague, its name,
   agent id, status, card (description, skills) and address. No reach check
   on B.
2. **Delegation history of A** (`GET /agents/:id/delegations`,
   `list_agent_delegations`): B's name and id, the task, the reason and an
   excerpt of B's answer. No reach check on B.
3. **A tells every caller.** The roster of colleagues (name, id, description,
   skills) is the description of `ask_agent`, served to the agent for any
   caller. An unknown peer name is answered with "Your peers are: …". The
   delegation step shown in the chat reads "Asking «B»" with the matched
   skills, the task and an excerpt, on every surface, anonymous included.
4. **Prod: any Admin reads any agent's A2A card.** `GET
   /a2a/agents/:id/.well-known/agent-card.json` accepts any Owner or Admin
   console token (`A2aCardGuard`) and checks neither reach nor manage. A test
   Admin got 200 for the Ranch assistant there, 404 for the same card on the
   console route (`/agents/:id/card`), and 404 for an id that does not exist.
   So it is an existence oracle for any id, and returns name, description,
   skills and knowledge-base names. The ids it needs come from findings 1, 2
   and 9.

### Changing a connection to a hidden colleague

5. **Whoever manages A removes or re-reads the connection to B** (`DELETE
   /agents/:id/peers/:peerId`, `remove_agent_peer`, `refresh_agent_peer`;
   through A itself `remove_my_peer`, for any caller). `requireOwned` checks
   only that the row belongs to A.
6. **Three rules for one action.** Console and Ranch-assistant tools connect
   only when the caller manages both ends. The agent's own tools connect for
   anybody, to any agent but the Ranch assistant. The rule asked for
   ("a signed-in person, agents they reach") would be a third.

### Using a hidden colleague

7. **Delegation checks nobody.** `ask_agent` resolves the peer against A's
   rows and calls it. The caller of the turn is not asked about, though the
   tool call does state who it is for.
8. **The receiving end has no say and no view.** B's manager cannot see who
   is connected to B (peers are listed by the asking side only) and cannot
   revoke a connection. Traffic from a peer is exempt from B's request limits
   by design (CLEAN-224). Putting B behind a public A publishes B with B's
   own limits switched off, and nobody who manages B is told.
9. **B's conversation list names A.** A handed-over task is stored at B as
   the conversation of `peer:<A's agent id>:<context>`, shown in B's chat list
   as a "Web visitor" with that id. B's manager learns A's id, and reads tasks
   written from the questions of A's callers, without reaching A.

### What a handed-over task is at B

10. **An anonymous caller.** The runtime has no notion of a peer. So (a) the
    task goes through B's visitor gate: with the default strategy `approval`
    B answers "Access denied, send this code", which A records as the
    answer, and a pending visitor is registered per context; (b) B's tools
    are a guest's, which today includes the tools that rewire B. "Ask your
    colleague to connect itself to …" is the same hole one hop away.
11. **The asker is not carried over the hop.** B cannot tell a User from a
    visitor. That is right for power (a task written by A's model must not
    run at B with the Owner's power), and it means reach can be asked at the
    first hop only. A→B→C is decided by B's own wiring.

### Other

12. **The step goes to the wrong chat.** `findActiveTurn(agentId)` returns
    the newest running turn of A, not the turn that asked. With two people
    talking to A at once, the task and the answer excerpt of one person's
    delegation can be pushed into the other's chat, and the audit row records
    the other's client id.
13. **An outside colleague writes into A's prompt.** Its card (name,
    description, skills) becomes part of the `ask_agent` description of every
    turn of A. If somebody who does not manage A can add one, that is a
    persistent prompt injection for all of A's callers, and every delegated
    task leaves the installation. A credential typed into the chat for it
    stays in the transcript.
14. **Card preview for an anonymous caller** makes the API fetch a public
    address of the caller's choosing.
15. **Chain tracking is one slot per agent** (`inboundChains`). Two inbound
    tasks at B at once overwrite and delete each other's chain, so the loop
    and depth rule can be lost under load.
16. **A scheduled turn has no person.** A job a User set up on A runs with
    nobody behind it. Any rule that asks about the person's reach has to say
    what such a turn may use.
17. **`GetTask` is not bound to the pair**: any valid pair credential reads
    any task by id. Ids are random and never leave the API. Low.

### What holds

- The fleet map filters both ends.
- An address of this installation is refused as an outside colleague after
  normalisation, for the address given and the one inside the card, at
  import and at every refresh. Redirects are never followed. Private
  addresses are refused at import, refresh and every delegation.
- The pair credential never leaves the API.
- The Ranch assistant is connected on either end by the Owner only, and a
  card never lists the agent's own colleagues.

## A model that closes them with one rule

**A connection A→B exists for a person only when that person reaches B.**
Asked wherever a connection is shown, used or changed:

| | Rule |
|---|---|
| See (Peers tab, list tools, history, roster, chat step) | manages A, and reaches B |
| Use (`ask_agent`, at call time) | reaches B |
| Connect a Ranch agent | reaches A and B. Gives nobody else anything, so a User may. |
| Remove | manages A and reaches B, or made the connection |
| Serve anonymous callers | only a connection marked "open to visitors", set by somebody who manages both A and B |
| Outside colleague for everybody | only somebody who manages A. A User's is their own. |
| A handed-over task at B | a peer, not a visitor: no gate, no tools that configure B, only connections open to visitors |

Accepted on 2026-11-20 and written into `spec.md`. Decided there: every hop
of a chain is checked against the person the chain was started for, and an
agent that person does not reach works for them only over a connection open
to visitors, shown unnamed; a scheduled turn uses only connections open to
visitors; B's manager gets no list of inbound connections.

Not closed by it: somebody who manages A and reads another person's
conversation with A sees B's name and answers there.
