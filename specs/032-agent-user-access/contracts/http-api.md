# Contract: HTTP routes and agent tools

DTOs are written in `api/`, emitted to `api/swagger-spec.json`, and
regenerated into both consoles (`bun run build:api`). Nothing here is
hand-written on the console side.

"Person" below means a caller subject to the lists: a console token, not an
agent runtime, role Admin or User ([data-model.md](../data-model.md)).

## Agent access

| Route | Who | Does |
|-------|-----|------|
| `GET /users/:id/agent-access` | Owner, Admin | the target's access as the caller may see it |
| `PUT /users/:id/agent-access` | Owner, Admin | replaces the part of the target's access inside the caller's view |

`GET /users` and `GET /users/:id` add `agentAccess: { kind, needsReview }` to
each user (kinds in the data model). The Owner's row carries `kind: 'all'`.

### `GET` response

```json
{
  "userId": "…",
  "allowed": ["agent-id", "…"],
  "denied": ["agent-id"],
  "outcome": { "kind": "only", "count": 2 },
  "needsReview": false,
  "hasEntriesOutsideView": false,
  "version": "2026-11-17T10:00:00.000Z"
}
```

`allowed` and `denied` hold only agents the caller reaches.
`hasEntriesOutsideView` is true when the target has entries, or reaches
agents, that the caller cannot see; no id or name of those is returned.
`version` is null for an account never edited.

### `PUT` body

```json
{ "allowed": ["…"], "denied": ["…"], "version": "…", "confirmOpen": false }
```

The body is the whole desired state inside the caller's view. An agent absent
from both arrays has no entry.

### Refusals

| HTTP | `code` | When |
|------|--------|------|
| 403 | `ACCESS_NOT_EDITABLE` | the target is the Owner, the caller themselves, or (for an Admin caller) another Admin |
| 400 | `ACCESS_LISTS_OVERLAP` | an agent is in both arrays |
| 404 | none, the ordinary "agent not found" | an id is unknown or outside the caller's view |
| 409 | `ACCESS_EXCEEDS_CEILING` | Admin caller, and the target would reach an agent it did not reach before and the caller does not reach |
| 409 | `ACCESS_OPEN_NEEDS_CONFIRM` | the change turns a limited account into an open one and `confirmOpen` is not true; the response carries the resulting outcome |
| 409 | `ACCESS_CHANGED` | `version` is not the current one |

A refusal saves nothing. `message` is a sentence a person can act on
(FR-018), for example "This would open agents you do not have. Ask the Owner."

## Pins

| Route | Who | Does |
|-------|-----|------|
| `PUT /agents/:id/pin` | any signed-in person | pins the agent for the caller; idempotent; 204 |
| `DELETE /agents/:id/pin` | any signed-in person | unpins it for the caller; idempotent; 204 |

Both are `@AgentScoped('id')`: an agent the caller does not reach answers 404.
A caller that is not a person (agent runtime, embed token) is refused 403.

`AgentDto.pinned` is now "pinned by the caller". `UpdateAgentDto.pinned` is
removed; `PUT /agents/:id` with a `pinned` field is rejected by validation as
any unknown field is.

## Creating and deleting

- `POST /agents` by an Admin whose account is limited adds the new agent to
  that Admin's allowed list in the same transaction (FR-023).
- `DELETE /agents/:id` removes its entries and pins by cascade. No account's
  `limited` changes (FR-006).
- `DELETE /users/:id` removes that account's access row, entries and pins.

## Reads that are now filtered

Every route in [enforcement.md](./enforcement.md). The response shapes do not
change; a person receives fewer rows, or 404 for one agent.

## Agent tools

In `api/src/slices/user/agentAccess/agentAccess.tool.ts`, audience `admin`
([acting-party.md](./acting-party.md)): the Owner and Admins, each under the
rules of the routes above, topic `ToolTopics.UsersKeys`.

| Tool | Title | Template | Destructive |
|------|-------|----------|-------------|
| `get_user_agent_access` | Show a user's agent access | `Which agents can «email» use?` | no |
| `set_user_agent_access` | Change a user's agent access | `Let «email» use only «agents»` | yes, `confirm` |

`set_user_agent_access` takes `userId`, and any of `allow`, `deny`, `clear`
(arrays of agent ids), plus `confirm`. Without `confirm: true` it changes
nothing and returns the outcome the change would produce, so the assistant
can state it and ask (FR-026). It calls `AgentAccessService.replace` as the
effective caller, so an Admin asking through the assistant meets the same
ceiling as in the console; the refusals above come back as tool errors with
the same sentences. Results carry ids and names of agents the caller reaches,
never a credential.

`pin_agent` stays under its name and changes meaning: it pins or unpins for
the person the assistant is acting for, and refuses when there is none
(FR-037). Its description and `docs/agent-tools.md` row are rewritten.

Every existing tool that lists agents or takes an agent id filters with
`reachableIds` or checks `reaches` for the effective caller, with the same
"not found" as the routes (FR-027). The list is in
[research.md](../research.md) R6 and is covered by one spec that runs each of
them as a limited Admin.
