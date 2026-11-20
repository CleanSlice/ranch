# Contract: colleagues

A is the agent that asks, B the colleague. "Reaches" and "manages" are
`AgentAccessService.reaches` and `AgentPermissionService.canManage`, as in
specs/032. The Ranch assistant is connected on either end by the Owner only,
unchanged (`PeerService.connect`).

## 1. The rule

`api/src/slices/agent/peer/domain/peerAccess.ts`, pure, pinned by
`peerAccess.spec.ts` with exactly this table:

| Connection | Viewer or caller | `visibility` | `serves` |
|---|---|---|---|
| Ranch, any | reaches B | `full` | yes |
| Ranch, open to visitors | does not reach B, or nobody | `masked` | yes |
| Ranch, not open | does not reach B, or nobody | `hidden` | no |
| Outside, shared | anybody | `full` | yes |
| Outside, personal | its owner | `full` | yes |
| Outside, personal | manages A, not the owner | `full` | no |
| Outside, personal | anybody else | `hidden` | no |

"Nobody": a guest, a trusted party, and a peer party with no `forUserId`.
For a peer party with `forUserId` the viewer is that account, read from the
database at the time of the call.

A `hidden` connection is answered everywhere as one that does not exist:
same status, same body, same tool text as an unknown id (`PeerErrorCodes.
NotFound`, "Peer connection not found").

## 2. Who may do what

| Action | Requires |
|---|---|
| See A's colleagues, A's hand-over history | manages A; each row by `visibility` |
| Connect a Ranch colleague | a person; reaches A and B |
| Connect an outside colleague | a person; reaches A. Shared when they manage A, personal otherwise |
| Preview a card by address | a person |
| Re-read a card | manages A, `visibility` is `full` |
| Remove | made it (`createdById`), or manages A and `visibility` is `full` |
| Open to visitors, close | manages A and manages B; `confirm` |
| Be served through `ask_agent` | `serves` |

Never: a guest, a trusted party (a scheduled turn, a messenger
administrator), a peer party, for any row of this table but the last.

## 3. HTTP (`/agents/:agentId/...`, `@ManagesAgent('agentId')` as today)

| Route | Change |
|---|---|
| `GET peers` | rows with `visibility` `full` or `masked`; hidden ones absent. New fields: `visibility`, `createdBy`, `openToVisitors`, `ownerUserId`, `needsReview`, `canRemove`, `canSetVisitors`. A masked row: `id`, `visibility`, `openToVisitors`, `skills`, the two `can*` (false) and nothing else |
| `GET peers/candidates` | agents the caller reaches (was: manages) |
| `POST peers` | `peerAgentId`: caller reaches it, else 404 as unknown. `url` / `card`: shared, since the caller manages A. Records `createdById` |
| `POST peers/preview` | unchanged |
| `POST peers/:peerId/refresh` | 404 unless `full` |
| `DELETE peers/:peerId` | 404 unless `full` or the caller made it |
| `PUT peers/:peerId/visitors` **new** | body `{ open: boolean, confirm: true }`. 404 unless the caller manages both agents and the row is a Ranch colleague. 409 `PEER_VISITORS_NEEDS_CONFIRM` without `confirm`. Clears `needsReview` |
| `GET delegations` | rows by the visibility of their connection; a masked row has no `peerName`, `peerAgentId`, and no `excerpt` |
| `GET peers/state` | unchanged |
| `GET /agent-links` | unchanged (already both ends) |
| `GET /a2a/agents/:id/.well-known/agent-card.json` | a console token is admitted only when its person manages the agent; otherwise the 404 of an unknown agent |

OpenAPI is regenerated; both console SDKs are rebuilt.

## 4. Tools

| Tool | Audience | Change |
|---|---|---|
| `list_my_peers`, `list_ranch_agents`, `preview_agent_card_by_address`, `connect_my_peer`, `import_my_peer_by_address`, `connect_my_peer_from_card`, `remove_my_peer` | `person` (was `agent`), agent token required | rules of §2 for the person the turn is for; `list_ranch_agents` returns agents that person reaches; no totals |
| `ask_agent` | `agent` | roster and call by `serves`; listed only when at least one connection serves the caller |
| `list_agent_peers`, `list_peer_candidates`, `preview_agent_card`, `list_agent_delegations`, `connect_agent_peer`, `import_external_agent`, `import_agent_from_card`, `refresh_agent_peer`, `remove_agent_peer` | `manage-agent`, a person required | same rules as the routes of §3 |
| `set_agent_peer_visitors` **new** | `manage-agent`, a person required | `{ agentId, peerId, open, confirm }`; topic `peers`, title "Open a peer to visitors", template "Open the peer «peer» of «name» to visitors"; destructive when `open` is true |

Refusals: a guest gets `PERSON_REFUSAL` ("This needs a signed-in person."),
never the name of an agent or of a console.

## 5. What the asking agent is told

`ask_agent` description, per caller:

```text
Your peers:
- "Billing" (peer: agent-…) — Answers invoices. Skills: Refunds (…); …
- "Colleague 1" (peer: <connection id>) Skills: Returns policy (…)
```

- a `full` row as today;
- a `masked` row: the label `Colleague N`, the connection id as its handle,
  skills, no description;
- a row that does not serve the caller is absent, and the "no peer matches"
  error names only the rows that are present.

Tool result for a masked row: `Reply from a colleague (context_id: …)`.
Progress step: label `Asking a colleague` / `Answered by a colleague`,
detail without the `Peer:` line; the structured `delegation` object carries
no name and no agent id.

## 6. Tests that pin it

- `peerAccess.spec.ts`: the table of §1, row by row.
- `peer.controller.spec.ts`, `peerAdmin.tool.spec.ts`, `peerSelf.tool.spec.ts`,
  `askAgent.tool.spec.ts`: for each route and tool, a hidden connection and a
  missing one give the same answer; a masked one gives no name.
- `toolAudience.spec.ts`: the audiences of §4.
- `a2a.guards.spec.ts`: an Admin and the card of an agent they do not manage.
