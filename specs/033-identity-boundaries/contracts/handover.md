# Contract: a hand-over between agents, and what the runtime is told

Two repositories: `CleanSlice/ranch` (the API) and `CleanSlice/runtime`.
Each side must work with the previous version of the other (§5).

## 1. The hand-over token

Signed by the API with the key that signs acting tokens
(`ActingPartyService`). Never stored, never logged.

```text
{ typ: 'handover',
  aud: 'agent:<B>',            // the agent that receives the question
  via: '<connection id>',      // the AgentPeer row it travels through
  chain: ['<agent>', …, '<A>'],// every agent so far, the asker last
  for?: '<user id>',           // the person the chain was started for
  ctx: '<A2A context id>',
  exp: now + A2A timeout + 60 s }
```

- Minted in `DelegationService.run`, placed in the A2A message as
  `metadata.ranch.pass`.
- Verified in `A2aServerService.sendMessage`: signature, `typ`, `aud` is the
  agent in the path, `via` is the connection the presented pair credential
  resolves to. A message without a valid pass from a Ranch connection is
  refused (`rejected`). An outside agent never calls in.
- `chain` is what the loop and depth rules read. `metadata.ranch.chain` is
  kept for display only.
- `for` is copied from the party of the asking call: a person's `userId`, a
  peer party's `forUserId`, absent otherwise. It is not a grant.

## 2. Hub to runtime

The message a runtime receives over the hub gains two optional fields:

| Field | When | Meaning |
|---|---|---|
| `admin: true` | the sender is an Owner or Admin console session, or an embed token with administrator roles | the sender is an administrator of this agent's installation. Replaces reading it off `clientId` |
| `handover: { token }` | the message is a colleague's question | the token of §1, to be carried as is |

`clientId` of a colleague's question: `peer:<connection id>:<ctx>`.

## 3. Runtime behaviour (runtime ≥ 0.36)

| Area | Rule |
|---|---|
| `isAdmin` of a hub turn | `msg.admin === true`, or `from === "admin"` (the Owner). `"admin"` stays in the admin ids for that reason only |
| Actor (`actor.ts`) | `handover` present → `{ kind: 'peer', token }`, ahead of every other rule but an actor resolved earlier in the turn. A delegated worker inherits it |
| Visitor gate (`bot.service.ts`) | a message with `handover` skips the access check, the access-code approval and the slash commands, and registers no pending visitor |
| Prompt | a colleague's turn is not an administrator's: `admin-only` blocks and admin skills are stripped, as for a visitor |
| Tool calls to Ranch | `_meta["ranch/actor"]` as today, with the new kind; plus `_meta["ranch/turn"] = { client: <msg.from> }` on turns that came over the hub |
| Catalogue cache | keyed by actor as today; a peer actor is keyed by its token |

The token is treated like the acting token: carried to Ranch's MCP servers
(those whose bearer is `RANCH_API_TOKEN`) and nowhere else.

## 4. API: the party of a tool call

`_meta["ranch/actor"]`:

| Stated | Party |
|---|---|
| `{ kind: 'person', token }` | as today |
| `{ kind: 'trusted', … }` | as today |
| `{ kind: 'peer', token }` | verified as in §1 with `aud` equal to the calling agent → `{ kind: 'peer', chain, connectionId, forUserId? }`. Invalid or expired → guest |
| anything else, or nothing | guest |

A peer party has a guest's level in `callerLevel`, is admitted to the
`everyone` and `agent` audiences only, and is refused by `requirePerson`.

`_meta["ranch/turn"].client` is read by `ask_agent` alone, to find the
running turn to show the step in. It is ignored unless that client has a
running turn with the calling agent.

## 5. Mixed versions

| API | Runtime | What happens |
|---|---|---|
| new | 0.35 | no `handover` understood: a colleague's question is a visitor's (gate applies, guest tools), as today. Its tool calls name nobody: only connections open to visitors, loop check from the legacy per-agent slot. An Admin is not an administrator to that agent until it restarts. Nobody gains anything |
| old | ≥ 0.36 | no `admin`, no `handover` arrives: every administrator is `from "admin"` as today. `ranch/turn` and the `peer` kind are never sent or are ignored |

Release order: runtime, restart agents, then Ranch (research R14).

## 6. Tests that pin it

- API: `handover.spec.ts` (mint, verify, wrong audience, wrong connection,
  expired), `mcp-tools.handler.spec.ts` (the party table of §4),
  `a2a.server.service.spec.ts` (two questions at once keep their own chains).
- Runtime: `actor.spec.ts` (the peer kind), a new `gate.spec.ts` (gate and
  commands skipped for a colleague), `turnOrigin.spec.ts` (`isAdmin` from
  the flag), `mcp.gateway.actor.spec.ts` (`ranch/turn`, the cache key).
- `specs/033-identity-boundaries/e2e/fakeRuntime.mjs`: a runtime that echoes
  what it was sent, in both versions.
