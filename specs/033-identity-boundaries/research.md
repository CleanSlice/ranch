# Research: Identity boundaries in chat and consoles

**Date**: 2026-11-20 · **Spec**: [spec.md](./spec.md) · **Findings**: [a2a-access-analysis.md](./a2a-access-analysis.md)

Every decision below was taken against the code of `main` at `85018270`
(Ranch v0.3.90) and the runtime at `d8f1794` (v0.35.0). Nothing here was left
as NEEDS CLARIFICATION.

## R1. One place decides what a connection is to a viewer

**Decision**: a pure module `api/src/slices/agent/peer/domain/peerAccess.ts`
answers two questions for a connection row and a party, and every route,
tool and listing asks it:

- `visibility(row, viewer)` → `full` | `masked` | `hidden`
- `serves(row, party)` → boolean

| Row | Viewer or caller | visibility | serves |
|---|---|---|---|
| Ranch colleague | reaches B | full | yes |
| Ranch colleague, open to visitors | does not reach B, or nobody | masked | yes |
| Ranch colleague, not open | does not reach B, or nobody | hidden | no |
| Outside colleague, shared (`ownerUserId` null) | anybody | full | yes |
| Outside colleague, personal | its owner | full | yes |
| Outside colleague, personal | a person who manages A | full | no |
| Outside colleague, personal | anybody else | hidden | no |

"Reaches" is `AgentAccessService.reaches`, unchanged. "Nobody" is a guest, a
trusted party and a peer party whose chain was started for nobody.

**Rationale**: the hole is that reach on B is asked in one place out of nine
(`peerLink.controller.ts`). One function called from all nine cannot drift,
and a spec pins the table.

**Alternatives**: filtering in each caller (how the hole came about);
filtering in `PeerService.list` only (the tools and `ask_agent` read the
gateway directly, and the delegation history is another table).

## R2. Open to visitors, and what "masked" removes

**Decision**: `AgentPeer.openToVisitors` (boolean, default false), with
`openedById` and `openedAt`. Set and cleared by a person who manages both
agents, through one route and one tool, with `confirm`.

A masked connection is rendered by rule, not by judgment:

- name → the constant `a colleague` (the roster numbers them when an agent
  has several: `Colleague 1`, `Colleague 2`);
- handle for `ask_agent` → the connection id, never the agent id;
- description → dropped. The fallback description is literally
  `Ranch agent «<name>».`, and an own description can say anything;
- skills → kept. The asking model cannot choose a colleague without them
  (spec, Assumptions);
- status, card, address, agent id, who connected it → dropped.

**Rationale**: Constitution VII. "Does this description give the agent away"
would be a judgment; "no description" is a rule.

**Alternatives**: masking the name only (the description leaks it in the
fallback case); a separate alias the manager types (one more field nobody
asked for).

## R3. A handed-over question carries a token, as a person's message does

**Decision**: a fourth party kind, `peer`, proven by a hand-over token the
API signs with the secret it already signs acting tokens with:

```text
{ typ: 'handover', aud: 'agent:<B>', via: <connection id>,
  chain: [<agent ids so far, A last>], for?: <user id>, ctx, exp }
```

`DelegationService.run` mints it and puts it in the A2A message metadata.
`A2aServerService.sendMessage` verifies it (audience is the agent in the
path, `via` is the connection the pair credential belongs to) and hands the
same token to B's runtime with the hub message, next to where `acting` goes
today. The runtime carries it verbatim on every tool call of that turn as
`_meta["ranch/actor"] = { kind: 'peer', token }`. The API turns it into
`{ kind: 'peer', chain, forUserId?, connectionId }`.

A peer party has a guest's level: it manages and configures nothing
(FR-023). `for` is used for reach and for nothing else.

**Rationale**: it is the acting-token mechanism of CLEAN-232, so nothing new
is trusted. It answers four findings at once: B knows the turn is a
colleague's (10a), B's tools stop being a visitor's set that rewires B
(10b), the chain travels with each call instead of sitting in one slot per
agent (15), and the person the chain was started for is known at every hop
without their power going along (11).

**Alternatives**: keeping the per-agent `inboundChains` map and adding the
person to it (one slot, still wrong under two tasks); carrying the person's
acting token down the chain (a question written by A's model would run at B
with the Owner's power); a flag on the hub message without a token (the
runtime's word, which is what CLEAN-232 stopped trusting).

**Expiry**: the A2A timeout plus one minute. A token outlives its turn by at
most that.

## R4. The rule at every hop

**Decision**: `ask_agent` asks `serves(row, party)` when it describes the
roster and again when it is called. For a peer party "the person" is
`forUserId`, read from the database at that moment (role and lists), absent
when the chain was started for nobody. Loop and depth are checked on the
receiving side from the token's `chain`; a call with no token (an agent on
runtime 0.35) falls back to the per-agent slot that exists today and is a
chain started for nobody.

**Rationale**: FR-002 and FR-024. Asking at call time means a change of
access needs no change to any connection.

**Known lag**: the runtime caches one caller's tool catalogue for 60 s
(`CATALOGUE_TTL_MS`). A colleague taken away from a person can stay named in
the roster for up to a minute. It cannot be asked: the call is refused.

## R5. The progress step goes to the turn that asked

**Decision**: the runtime adds `_meta["ranch/turn"] = { client: <msg.from> }`
to tool calls of a turn that came over the hub. `findActiveTurn(agentId,
clientId)` returns that client's running turn of that agent, or nothing.
Without the field (runtime 0.35) the step is shown only when the agent has
exactly one running turn; otherwise it is not shown.

**Rationale**: today the step goes to the newest running turn of the agent,
so with two callers one sees the other's task and answer excerpt (finding
12). The field is a routing hint from the agent's own runtime about its own
client. It grants nothing, and it is checked against the turns the hub knows.

**Alternatives**: deriving the client from the person (does nothing for two
anonymous callers).

## R6. A sign-in per console

**Decision**:

- `Session.surface`: `'admin'` | `'app'`, nullable. A row without it is not
  renewable (FR-040).
- Two cookies on the API host, `ranch_session_admin` and
  `ranch_session_app`, same options as today. The old `ranch_session` is
  cleared whenever it is seen and never read.
- Each console states itself in a request header, `X-Ranch-Console`, set
  once in its API client plugin (`admin/slices/setup/api/plugins/
  apiBaseUrl.ts`, `app/slices/setup/api/plugins/api.ts`). Login and register
  create the session with that surface and set that cookie. Refresh and
  logout read only that cookie, and refuse a session whose `surface` differs
  (FR-037), with the existing `SESSION_INVALID`.
- A request with no header, or an unknown value, has no session: refresh
  answers `SESSION_INVALID`, login is refused with a 400. No default.

**Rationale**: the cookie is host-only on the API host and both consoles
call that host, so only the name can tell the two apart, and only the
console knows which one it is. Recording the surface on the row is what
makes FR-037 true: the admin cookie's value presented under the app's name
finds a session of the other surface.

**Why not the `Origin` header**: it would bind a surface to a host, and the
consoles' hosts are configuration a fork changes (`CORS_ORIGIN` is a list
with no roles in it; in local development both are `localhost`). The header
is a selector, not an authority: a page that could send the other console's
value could equally have asked for that console's cookie before.

**Alternatives**: a `Domain`/`Path` split (one API host serves both, `/auth`
is one path); one cookie holding two sessions (a renewal of one would
rewrite the other).

## R7. The Owner keeps the conversation, every Admin gets their own

**Decision**: the chat identity of a console person is decided by the live
console session, not by the roles in the token:

- the Owner → `admin`, the id the shared conversation has today;
- an Admin → their user id, as a User already has;
- an embed token with administrator roles → its `sub`, as for other embed
  tokens (it was `admin` until now).

Nothing is moved: session files in every agent's storage
(`data/sessions/bridle:admin.jsonl`), the chat index rows with
`externalUserId = 'admin'`, and scheduled jobs addressed to `admin` are all
already the Owner's the moment nobody else can be `admin` (FR-034).

Whether the sender is an administrator stops being read off the id. The hub
adds `admin: true` to a message whose sender is an Owner or Admin console
session, or an embed token with administrator roles, and the runtime's
`isAdmin` for a hub message is that flag. `from === "admin"` stays an
administrator in the runtime: it is the Owner.

**Rationale**: "the chats stay with the Owner only" is then true by
construction, with no migration over files that running pods hold open and
sync to object storage. There is exactly one Owner and no way to transfer
ownership in the product, so the id cannot become shared again. A message
joins a running task by session (`router.gateway.ts`), and a session is
`bridle:<from>`, so a unique `from` per person is what closes the join
(FR-031) with no change to the router.

**Alternatives**: giving the Owner their user id and moving the files (a
migration across object storage and live pods, for the same visible result);
leaving the id to roles in the token (an embed token minted with the Owner
role would open the Owner's conversation).

**Consequence**: an Admin's messages already in the shared conversation stay
there (spec, Assumptions).

## R8. Every `clientId === 'admin'` that means "an administrator"

**Decision**: replaced by the requester's `isAdmin`, which the same
verification already computes. Sites:

| Site | Today | After |
|---|---|---|
| `bridle.controller.ts` `limitSourceOf` | operator when id is `admin` | operator when `isAdmin` |
| `bridle.controller.ts` `requireChannelAccess` | reads any channel when id is `admin` | reads own channel; another channel when `isAdmin` and manages the agent |
| `bridle.controller.ts` 942, 1052 | `isAdmin` from the id | from the requester |
| `bridle.controller.ts` 1002, 1120, 1171 | channel defaults to `admin` | defaults to the requester's own id |
| `bridleAgentWs.handler.ts` 211 | `isAdmin` from the id | from the registered client |
| `myChat.controller.ts` `ownExternalId` | `admin` for both roles | `admin` for the Owner, `sub` otherwise |
| `chat.controller.ts` 198 | cited sources attached as client `admin` | as the caller's own id, `isAdmin` kept |
| admin `bridle` store `DEFAULT_CHANNEL`, `Provider.vue` | `admin` | the id the hub's `welcome` gave |
| admin `chatList.ts` | label `Admin` for id `admin` | the Owner's name; other administrators by name |

`requireChannelAccess` gains the manage rule on purpose: reading another
person's conversation is supervision of the agent (FR-035).

## R9. An embed token never opens an account's conversation

**Decision**: `mintEmbedToken` refuses a `sub` that is the id of an existing
account or a reserved id, and the hub treats an embed token whose `sub` is an
account id as unusable, as it does a reserved one.

**Rationale**: a conversation is named by the id, and an embed token's `sub`
is chosen by whoever holds an API key with `embed:mint`. Today that already
opens a User's conversation by naming their id. With R7 it would open an
Admin's. Tokens live up to seven days, hence the check at the hub as well.

## R10. Audiences of the colleague tools

**Decision**:

| Tools | Today | After |
|---|---|---|
| `peerSelf.tool.ts`: list, candidates, preview, connect, import, from card, remove | `agent` (any caller) | `person`, and the call must come from an agent's own token |
| `askAgent.tool.ts` | `agent` | `agent`, roster and call filtered by `serves` |
| `peerAdmin.tool.ts` | `manage-agent`, trusted allowed | `manage-agent`, a person required (FR-012); the colleague's end asks reach, not manage |
| new `set_agent_peer_visitors` | none | `manage-agent`, manage on both ends, `confirm` |

`toolAudience.spec.ts` pins the table and `docs/agent-tools.md` is updated in
the same PR, with the `peer` party added to its table of parties.

**Rationale**: FR-009, FR-010, FR-012. `person` is the audience that already
means "a signed-in person, whatever the role".

## R11. A colleague's conversation at B

**Decision**: the hub client id of a hand-over becomes
`peer:<connection id>:<context>`. The chat list DTO gains `peer`:
`{ name?: string }`, with the name present only when the viewer reaches the
asking agent, and the admin list shows the kind `Colleague`.

**Rationale**: FR-026. The connection id says nothing to somebody who cannot
list A's colleagues.

**Not migrated**: conversations stored before the upgrade keep
`peer:<agent id>:…` in their name. The main installation has none.

## R12. The public card

**Decision**: `A2aCardGuard` keeps accepting a console token, and then asks
`AgentPermissionService.manageable`. A refusal is the `NotFoundException`
`AgentCardService.build` throws for an unknown id.

**Rationale**: FR-008, confirmed on prod. Neither console calls this route
with a console token; removing the path altogether would break whoever
scripts against it, for no gain over the manage rule.

## R13. Connections that exist at the upgrade

**Decision**: the migration sets `openToVisitors = true` and
`needsReview = true` on every existing Ranch connection, and leaves outside
connections shared. `createdById` stays null, shown as "predates the record".
The Owner sees a count on the fleet page and the mark on each row; saving the
row's visitors setting, either way, clears it.

**Rationale**: FR-029. Today such a connection serves everybody, and a fork
with a public front agent must not go quiet on upgrade.

## R14. Order of release

1. Runtime, then restart of the agents. New runtime with the old API changes
   nothing: no hand-over token arrives, `from === "admin"` is still what the
   API sends for every administrator.
2. Ranch. An agent still on 0.35 treats an Admin as a signed-in person who
   is not an administrator of it (it may ask for an access code) and a
   colleague's question as a visitor's, as today. Nobody gains anything
   (FR-041): the API alone decides tools, rosters and reach.

## R15. Deliberately not done

- Whoever manages B gets no list of agents connected to B and no way to cut
  them (spec, Assumptions).
- What a manager reads in another person's conversation, and what an agent's
  memory carries between conversations.
- Request limits of B for questions from colleagues (CLEAN-224, by design).
- `GetTask` is bound to the connection it was made through (FR-027); the
  task store itself stays in memory.
