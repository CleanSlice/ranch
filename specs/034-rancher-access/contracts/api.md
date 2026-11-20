# Contract: HTTP routes (CLEAN-240)

All under the existing JWT + roles guards. Shapes are the contract; DTO names
are the implementer's. Envelope as everywhere else in the API.

## Shared shapes

```
Choice      = { level: 'basic' | 'standard' | 'full' }
            | { level: 'custom', on: string[] }

Setting     = { enabled: boolean, level, on?: string[] }      // what was chosen

Resolved    = {
  enabled: boolean,
  level: 'basic' | 'standard' | 'full' | 'custom',
  matchesLevel: 'basic' | 'standard' | 'full' | null,          // for custom
  source: 'role' | 'account' | 'owner',
  offered: number, available: number,                          // within the role ceiling
  version: string | null,
}

Ability     = { name, title, area, effect: 'read'|'write', destructive: boolean,
                minRole: 'User'|'Admin'|'Owner', levels: ('basic'|'standard'|'full')[] }
Area        = { key, title, order, abilities: Ability[] }
```

## Owner: roles and overview

| Route | Who | Does |
|---|---|---|
| `GET /assistant-access` | Owner | `{ assistant: { id, name } \| null, roles: { Admin: Resolved & { accounts: number }, User: … }, exceptions: [{ userId, name, email, role, resolved: Resolved, updatedBy, updatedAt, reducedByRole: boolean }], notice: { usersManagingAgents: number } \| null }` |
| `PUT /assistant-access/roles/:role` | Owner | Body `Setting & { version }`. `:role` is `Admin` or `User`. 409 on a stale `version`. Returns the role's `Resolved`. |
| `DELETE /assistant-access/notice` | Owner | Dismisses the one-time notice. |

## Accounts

| Route | Who | Does |
|---|---|---|
| `GET /users/:id/assistant-access` | Owner; Admin for a User they may edit | `Resolved & { role, roleSetting: Resolved, editable: boolean, ceiling: string[] \| null, on?: string[], new?: string[] }`. `ceiling` is the editor's own offered names when the editor is an Admin. |
| `PUT /users/:id/assistant-access` | same | Body `Setting & { version }`. Refusals: 403 target is Owner / self / an Admin edited by an Admin; 422 `ABOVE_YOUR_OWN` with the offending names when an Admin grants more than they have; 422 `UNKNOWN_ABILITY`. |
| `DELETE /users/:id/assistant-access` | same | Drops the exception. Idempotent. |

An account the caller may not see answers 404 with the same body as an unknown
id (specs/032).

## Catalogue

| Route | Who | Does |
|---|---|---|
| `GET /assistant-access/catalog` | Owner, Admin | `{ areas: Area[], alwaysOn: Ability[] }` — every governed ability with the levels it belongs to. The same for every caller: what is disabled for a role is decided by `minRole` in the console. |

## The person

| Route | Who | Does |
|---|---|---|
| `GET /me/assistant-access` | any signed-in person | `{ enabled, level, matchesLevel, areas: [{ key, title, offered, available }] }`. Nothing about other accounts, no names of who set it. |

## Changed routes

- `GET /agents/admin/current`: reach now answers the assistant switch. Also
  open to `User` (it was Owner/Admin only): a User with the assistant on gets
  the reader view.
- `GET/PUT /users/:id/agent-access`: the assistant's id never appears in
  `allowed`/`denied`; a write naming it is refused with 422
  `ASSISTANT_NOT_LISTED`.
- `GET /agents/:id/tools` (Tools panel): unchanged for the Owner and Admin who
  open it; no per-person view is added here.
