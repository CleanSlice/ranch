# Data model: Agent access by role

Phase 1 of [plan.md](./plan.md). Decisions behind it: [research.md](./research.md)
R1, R2, R7.

## New models

### `UserAgentAccess` — `api/src/slices/user/agentAccess/agentAccess.prisma`

One row per account that has ever had its access edited. No row means the
defaults: not limited, no entries.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | String, primary key | bare id, no foreign key (repo convention for `User`) |
| `limited` | Boolean, default false | true while the account is restricted to its allowed entries |
| `updatedById` | String, nullable | who made the last change; not shown in this version |
| `updatedAt` | DateTime, `@updatedAt` | also the `version` of the optimistic check |
| `createdAt` | DateTime | |

### `UserAgentAccessEntry` — same file

| Field | Type | Notes |
|-------|------|-------|
| `userId` | String | |
| `agentId` | String | foreign key to `Agent`, `ON DELETE CASCADE` |
| `list` | String | `allowed` or `denied` |
| `createdAt` | DateTime | |

Primary key `(userId, agentId)`. Index on `agentId` for the cascade.

### `AgentPin` — `api/src/slices/agent/pin/agentPin.prisma`

| Field | Type | Notes |
|-------|------|-------|
| `userId` | String | |
| `agentId` | String | foreign key to `Agent`, `ON DELETE CASCADE` |
| `createdAt` | DateTime | |

Primary key `(userId, agentId)`.

## Changed model

`Agent.createdById` is added (CLEAN-232): String, nullable, bare user id with
no foreign key. Written once at creation from the console token or the acting
token; null for agents that exist today and for agents created by a trusted
party. Never updated. `AgentDto` gains `createdBy: { id, name, email } | null`
resolved for Owner and Admin readers; a deleted creator resolves to
`{ id, name: null }`.

```text
canManage(caller, agent) =
    caller is Owner
    OR (caller is Admin AND reaches(caller, agent))
    OR (agent.createdById = caller.id AND reaches(caller, agent))
```

`Agent.pinned` is dropped. `AgentDto.pinned` remains and is computed for the
caller from `AgentPin`; it is `false` for a caller that is not a person.

## Invariants

| # | Invariant | Held by |
|---|-----------|---------|
| I1 | An agent is on at most one list of an account, at most once | primary key `(userId, agentId)` |
| I2 | No entry or pin outlives its agent | `ON DELETE CASCADE` |
| I3 | No entry or pin outlives its account | `AgentAccessService.removeUser`, called from the user delete path |
| I4 | `limited` is true whenever an allowed entry exists | every write goes through `AgentAccessService` |
| I5 | `limited` turns false only on a confirmed change by a person | `replace`, R8 step 5 |
| I6 | The Owner has no row that matters | `reaches` returns true for Owner before reading anything |

## Derived values

```text
caller            = the effective caller (contracts/acting-party.md): the person
                    on a console token, or the person an agent states it acts for
subject(caller)   = caller is a person AND role in {Admin, User}

reaches(caller, agent) =
    true                                   if not subject(caller)
    false                                  if agent on caller's denied list
    false                                  if limited AND agent not on allowed list
    true                                   otherwise

restricted(account)  = limited OR any denied entry
needsReview(account) = limited AND no allowed entry
```

Outcome shown in the editor and the user list (FR-020, FR-022):

| `kind` | When | Sentence |
|--------|------|----------|
| `all` | not limited, no denied | Reaches every agent |
| `all_except` | not limited, n denied | Reaches every agent except n |
| `only` | limited, n allowed | Reaches only these n |
| `none` | limited, 0 allowed | Reaches no agents — needs review |

For an Admin looking at a User, n counts only entries inside the Admin's view,
and `hasEntriesOutsideView` says there are more (FR-017).

## State transitions of an account

```text
            add first allowed entry
  open  ───────────────────────────────▶  limited (n ≥ 1)
   ▲                                          │
   │  remove last allowed entry, confirmed     │  last allowed agent is deleted
   └───────────────────────────────────────────┤
   ▲                                          ▼
   │  empty the list, confirmed          limited (0) = needs review
   └────────────────────────────────────────  │
                                              │ add an allowed entry
                                              ▼
                                        limited (n ≥ 1)
```

Denied entries do not move an account between these states.

## Migration

Part A: `<timestamp>_agent_created_by/migration.sql` adds the nullable
`Agent.createdById`. Additive, no backfill.

Part B: one additive-then-destructive migration,
`api/prisma/migrations/<timestamp>_agent_access_and_pins/migration.sql`:

1. create `UserAgentAccess`, `UserAgentAccessEntry`, `AgentPin`;
2. drop `Agent.pinned`.

No backfill: every account starts open with no pins (FR-024, FR-036). Step 2
is not reversible; the previous value was a display preference and is meant to
be discarded.

## Browser-kept keys

| Console | Before | After |
|---------|--------|-------|
| app | `bridle:conversation:<key>` | `bridle:conversation:<userId>:<key>`; `share:…` keys unchanged |
| app | `bridle:seq:<key>` | `bridle:seq:<userId>:<key>`; `share:…` keys unchanged |
| app | `agent:lastOpened` | `agent:lastOpened:<userId>` |
| admin | `bridle:debug:<agentId>` | `bridle:debug:<userId>:<agentId>` |
| admin | `bridle:outbox:<agentId>:<channel>` | `bridle:outbox:<userId>:<agentId>:<channel>` |

Old console keys are removed once, on the first boot after the upgrade. View
preferences that name no agent (`agent:view`, `agent:sheetOpen`,
`admin.list.*.view`, theme and locale cookies) are left as they are.
