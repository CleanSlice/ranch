# API contract: Pin agents (CLEAN-216)

What the API promises to both consoles and to the Ranch agent. The generated
SDKs are the source of the types; this file is what the regenerated types must
show.

## `AgentDto` (every agent read)

```
pinned: boolean   // swagger: "When true, the agent is kept at the top of every
                  //  agent list in both consoles. Installation-wide."
```

Present on `GET /agents`, `GET /agents/public`, `GET /agents/:id`,
`GET /agents/admin/current`, and the agent object every agent tool returns.

## `UpdateAgentDto` (`PUT /agents/:id`)

```
pinned?: boolean  // @IsOptional() @IsBoolean()
```

- Roles: `Owner`, `Admin` (unchanged route gate). A `User` gets `403`.
- Semantics: when present, written as given; when absent, untouched. The
  reply is the full updated `AgentDto`.
- No side effect: no status write, no `AgentStatusChanges` emit, no bridle
  message, no workflow, no `updatedAt`-driven behaviour beyond Prisma's own
  `@updatedAt`.
- Validation: anything but a boolean is `400` from `class-validator`, like
  `debugEnabled`.

## Tool `pin_agent` (Ranch admin agent, operator audience)

```
name:      pin_agent
topic:     Agents
title:     Pin or unpin an agent
template:  Pin the agent «name»
params:    { id: string, pinned: boolean }
```

| Case | Result |
|---|---|
| operator, agent exists | `{ ok: true, agent: { id, name, pinned }, message: "Agent «name» is pinned — it stays at the top of every list." }` (or "… is unpinned.") |
| agent not found | the slice's `notFound(id)` payload with "resolve a name with list_agents first" |
| caller is not an operator | `ForbiddenException` from `requireOperator`, nothing written |

No `confirm` (not destructive). No field of the agent other than `id`,
`name`, `pinned` in the result.

## Unchanged on purpose

- `CreateAgentDto`: no `pinned`.
- `GET /agents` ordering: still `createdAt desc`; ordering by pin is a
  console rule.
- `AgentStatusChanges`: still status-only.
