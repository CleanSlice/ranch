# Data model: assistant access (CLEAN-240)

## Stored

### AssistantRoleAccess — what a role gets

One row per role that the Owner has configured. No row = the default.

| Field | Type | Notes |
|---|---|---|
| `role` | `'Admin' \| 'User'`, primary key | Never `Owner` |
| `enabled` | boolean | The switch |
| `level` | `'basic' \| 'standard' \| 'full' \| 'custom'` | |
| `custom` | JSON, null unless `level = 'custom'` | See Choice |
| `updatedById` | string, nullable | Bare user id, repo convention |
| `updatedAt` | datetime | Also the optimistic `version` |

Defaults when there is no row: Admin `{ enabled: true, level: 'full' }`,
User `{ enabled: true, level: 'basic' }`.

### AssistantAccountAccess — one account's exception

One row per account that differs from its role. Deleting the row returns the
account to its role.

| Field | Type | Notes |
|---|---|---|
| `userId` | string, primary key | Bare id; removed with the account (`removeUser`) |
| `enabled` | boolean | |
| `level` | as above | |
| `custom` | JSON, nullable | |
| `updatedById` | string, nullable | Shown in the overview ("who set it") |
| `createdAt`, `updatedAt` | datetime | `updatedAt` is the `version` |

### Choice (the `custom` JSON)

```
{ on: string[], known: string[] }
```

- `on` — tool names offered. `known` — every governed tool name that existed
  when the choice was saved; `on ⊆ known`.
- Validation on write: every name exists in the catalogue and is governed
  (audience `person`, `reader`, `manage-agent`, `admin`); names above the
  target's role ceiling are refused, not stored; duplicates removed; sorted.
- On read: names no longer in the catalogue are dropped; catalogue names
  missing from `known` are reported as `new`.
- A custom choice whose `on` equals a level's set is still stored as custom;
  the view reports `matchesLevel` so the console can show the level's name.

### Changed: UserAgentAccessEntry

No schema change. After the migration no row names the assistant, and
`AgentAccessService.change()` refuses its id.

### Changed: `@Tool` metadata

`effect: 'read' | 'write'` — required. Boot refuses a tool without it, and
`destructive: true` with `effect: 'read'`.

## Derived (never stored)

### Ability

A tool as the settings see it:
`{ name, title, area, effect, destructive, minRole, governed }`.

- `area` = the tool's `topic`.
- `minRole` from the audience: `person`/`reader` → User; `manage-agent` →
  User ("for agents they manage"); `admin` → Admin; `owner` → Owner.
- `governed` = audience is not `everyone` or `agent`.

### Level set

`levelSet(level, abilities)`:

- `basic` = `effect === 'read'` or audience `person`
- `standard` = basic, or `effect === 'write'` and area ∈ { agents,
  agent_workspace, knowledge, skills, peers, paddock }
- `full` = all governed

### Effective grant for a person

```
Owner / trusted            → everything (never looked up)
person, Admin or User      → row = account row ?? role row ?? role default
                             enabled = row.enabled
                             names   = row.level === 'custom'
                                         ? row.custom.on ∩ catalogue
                                         : levelSet(row.level)
                             offered = names ∩ (what the role's audience allows)
guest                      → not governed here (already nothing managerial)
```

`source` = `'account'` or `'role'`, for "Set for this account" / "Same as all
Admins".

### Reach of the assistant

`AgentReach.has(assistantId)` = `enabled` of the effective grant, for a
person; `true` for the Owner and non-persons, as today for every agent.

## Rules

1. A setting never adds a tool the audience refuses (enforced by order: the
   audience filters first, the grant only removes).
2. An account row wins over the role row, more or less.
3. An Admin may write a User's row only when the result is a subset of the
   Admin's own offered set. Which Users an Admin may edit is the specs/032
   rule, unchanged.
4. Nobody writes a row for an Owner or for themselves. An account promoted to
   Owner keeps its row, ignored (same as its agent lists).
5. Every write records `updatedById`; every write and every delete is logged
   with editor, target, before and after (FR-031).

## State transitions

```
(no row) ──set──▶ row(level) ──set──▶ row(custom) ──pick level, confirmed──▶ row(level)
    ▲                 │                    │
    └──── reset (account rows only) ───────┘
```
