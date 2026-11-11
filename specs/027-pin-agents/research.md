# Research: Pin agents (CLEAN-216)

Phase 0 of [plan.md](./plan.md). Every decision below was taken against the
code on `feat/CLEAN-215-app-console-redesign` (the branch this work stacks on)
on 2026-11-09. No `NEEDS CLARIFICATION` was left in the plan.

## R1. The field: `pinned`, boolean, default false, on `Agent`

**Decision**: `pinned Boolean @default(false)` in
`api/src/slices/agent/agent/agent.prisma`, next to `isPublic` / `isAdmin`;
migration `20261109120000_agent_pinned` with a single additive `ALTER TABLE`.

**Rationale**: the brief says one flag; every existing agent boolean
(`debugEnabled`, `isPublic`, `isAdmin`) is modelled exactly this way, and a
`NOT NULL DEFAULT false` column needs no backfill and is safe on a live
database (the pattern the `skill_library_order` migration documents).

**Alternatives considered**: a per-user `AgentPin` join table (rejected: the
brief says literally one flag, and a per-person list is a different feature);
a `pinnedAt` timestamp to order pins by recency (rejected: ordering inside
the pinned block keeps the list's own order by spec, so the timestamp would
be unused).

## R2. Transport: the existing `PUT /agents/:id`

**Decision**: `UpdateAgentDto` gains `pinned?: boolean` (like `debugEnabled`,
on the update DTO only, not on create); `IUpdateAgentData.pinned`;
`AgentGateway.update` writes it with the same `!== undefined` spread the other
fields use; `AgentDto` and `IAgentData` carry `pinned`. No new endpoint.

**Rationale**: the route exists, is gated `@Roles(Owner, Admin)` (FR-002), and
both console SDKs already carry `agentControllerUpdate`. One write path for
the sheet, the admin header and the tool. The controller's `update` only has a
side effect for `debugEnabled`; `pinned` adds none.

**Alternatives considered**: `POST /agents/:id/pin` + `DELETE` (rejected: two
routes, two SDK methods in two consoles, two gateway methods, for a boolean
the update route already can carry). Including `pinned` on `CreateAgentDto`
(rejected: nobody pins an agent that does not exist yet; the admin create form
has no such control).

## R3. Ordering: one rule, two pure functions per console

**Decision**: "admin agent first, then pinned, then the rest; inside each
block the list's own order."

- App `railOrder` (`app/slices/agent/utils/railOrder.ts`): today
  `[isAdmin…, rest…]`; becomes `[isAdmin…, pinned…, rest…]` with the same
  index loops (the Bun JIT note in memory: no `for…of` + `while` over arrays).
  Used by `Rail.vue` (both the side rail and the List view) and `Drum.vue`.
- App `orbitOrder` (`app/slices/agent/utils/orbitLayout.ts`): sort key
  becomes `(pinned desc, statusRank, isAdmin, index)`. A pinned stopped
  agent sits on the inner ring ahead of a running unpinned one; the spec's
  assumptions say so on purpose.
- Admin `useAgentRailEntries` sorts inline today
  (`sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin))`); the comparator
  moves into a new pure `admin/slices/agent/agent/utils/railOrder.ts` that
  is the byte-for-byte twin of the app's, with the same test file, so the
  two cannot drift silently (constitution II).

**Twin grep** (2026-11-09): `railOrder` exists only in `app/`;
`useAgentRailEntries` only in `admin/`; `orbitOrder` only in `app/` (admin has
no orbit). `isAdmin` ordering also appears in `admin/.../pages/agents/index.vue`
(the landing resolver: Rancher, else newest) — extended to "Rancher, else first
pinned, else newest" so an operator with a pinned agent lands on it.

**Alternatives considered**: pinned ahead of the admin agent (rejected: both
rails document the admin agent as "the one that manages the rest" and the
spec keeps it on top); pinned block sorted by status in the rail (rejected:
the rail has never sorted by status, only the orbit does).

## R4. The icon

**Decision**: app uses the lucide `pin` glyph through the slice's `<Icon
name="pin">` (the component used for `shield`, `chevron-down` on the same
surfaces), and `pin-off` on the Unpin control; admin uses `IconPin` for the
state and the control, `IconPinnedOff` for Unpin, from `@tabler/icons-vue`
which `RailItem.vue` and `Main.vue` already import `IconShield` from. The
state icon carries a `title` (admin) or a visually hidden text (app,
`$t('sheet.pinned')`) so screen readers announce it (FR-004).

**Rationale**: zero new dependencies; both icon sets ship these glyphs in the
versions installed (lucide ≥ 0.300 has `pin` / `pin-off`; tabler ≥ 2.0 has
`IconPin` / `IconPinned` / `IconPinnedOff`). To be confirmed at the first
render; the fallback is `bookmark` / `IconBookmark`, same semantics.

## R5. Optimistic toggle with rollback, and the admin "pending restart" banner

**Decision**:

- App: `useAgentControls` gains action `'pin'`: `const rollback =
  store.patch(id, { pinned: next })`, then `await store.update(id, { pinned:
  next })`, `catch → rollback()` and `failed = { action: 'pin', message }`
  shown by the sheet through the same `failedKey` switch with
  `sheet.pin_failed`. `busy` guards double clicks like the other actions.
- Admin: new `useAgentPin(agentId, agent)` returning `{ pinned, toggling,
  error, toggle }` with the same patch / update / rollback shape, consumed by
  `Main.vue`'s header. It calls `agentStore.update` directly and **not**
  `markPendingRestart`: the visibility and edit forms call that after their
  updates because their fields reach the pod on the next restart; the pin
  never reaches the pod (FR-007), so no banner.

**Rationale**: constitution IV and `docs/state.md`: an optimistic change goes
through `patch()` and carries a rollback; the store's rollback restores only
fields still holding the guessed value, so a poll landing in between is not
undone.

**Alternatives considered**: non-optimistic (wait for the server, then
upsert): rejected, SC-001 asks for an instant result and the other controls
are optimistic.

## R6. The tool: `pin_agent`, no confirm

**Decision**: one tool on `AgentAdminTool`:

```
name: 'pin_agent'
topic: ToolTopics.Agents
title: 'Pin or unpin an agent'
template: 'Pin the agent «name»'
parameters: { id: string, pinned: boolean }
```

`requireOperator(httpRequest)`; `findById` → `notFound(id)` with the
"resolve a name with list_agents first" wording the siblings use;
`agents.update(id, { pinned })`; result `ok({ ok: true, agent: { id, name,
pinned }, message })`. Audience: the class is already conditionally listed to
operators; the new method inherits that (`agentAdmin.tool.spec.ts` asserts
listing per audience for the class, the new cases assert the method's own
`requireOperator`).

**Rationale**: `docs/agent-tools.md` — a tool per console capability, in the
slice, with the four metadata fields, gated, and `confirm` only on destructive
tools. Pinning is reversible with one more call and touches no pod, so a
confirm would be noise. One tool with a boolean rather than `pin_agent` +
`unpin_agent`: the panel shows one row, the model has one less name to pick.

**Also seen, left alone**: `admin/slices/setting/pages/settings/mcp.vue`
carries a hand-written tool list that already lacks `stop_agent`,
`start_agent`, `delete_agent` and the peer tools; it documents an older
`rancher.tool.ts`. Not this ticket's debt to pay; noted in the PR.

## R7. Live propagation

**Decision**: none added. `AgentStatusChanges` emits only status transitions;
the pin reaches other open consoles with the next agent fetch (the app polls
`fetchAll` every 30 s; the admin refetches on navigation and on its own
timers). The spec's edge case says "next refresh" and SC-003 says "next
load".

**Alternatives considered**: a `pinned` event on the status stream (rejected:
the stream is "every real change of an agent's **status**", and a pin is not
one; widening its contract for a cosmetic flag is the kind of sideways reach
the constitution warns about).

## R8. Copy and i18n

**Decision**: app `agent/i18n/locales/en.json`:

```
"sheet": {
  "pin": "Pin",
  "unpin": "Unpin",
  "pinned": "Pinned",
  "pin_failed": "Pin failed"
}
```

`bun run i18n:sync` generates `ru`; the generated Russian is read and, if
the tone is off, corrected in `ru.json` **after** the sync (never before).
Admin literals: `Pin` / `Unpin` on the button title, `Pinned` on the state
icon's title.

## R9. Regenerating the SDK

**Decision**: `cd api && bun run build && bun run generate:swagger`, then
`cd app && bun run build:api` and `cd admin && bun run build:api`. Before
committing, `git diff --stat app/slices/setup/api admin/slices/setup/api`
must show only this ticket's field; if the regen drags in types from other
unmerged tickets (seen before: memory "SDK regen may carry older tickets'
types"), those hunks are reverted with `git show HEAD:<path>` so the PR diff
stays honest. Generated files are never edited by hand.

## R10. Tests and browser checks

**Decision**:

- API: `agent.gateway.spec.ts` + one case (update writes `pinned`, mapper
  reads it); `agentAdmin.tool.spec.ts` + four cases (pin, unpin, not found,
  non-operator refused, no secret in result). Run with jest directly.
- App: `railOrder.test.ts` + pinned cases; `orbitLayout.test.ts` + "pinned
  stopped ahead of running unpinned, admin rule inside blocks". `bun test
  slices`.
- Admin: new `utils/railOrder.test.ts`, same cases as the app's. `bun test
  slices`.
- Browser: `specs/027-pin-agents/e2e/pin.mjs` reuses
  `specs/026-app-console-redesign/e2e/lib.mjs` (login, API session, agent
  picker): pins the last unpinned agent through the sheet, asserts it is the
  first rail row, the first drum card and the first orbit node, that the icon
  is present, unpins, asserts the order is back; a second run as a regular
  User asserts no control is shown. Screenshots at 1440 and 390 for the
  ticket. Admin: `e2e/admin-pin.mjs` against :3001 with the same seeded
  Owner; if the admin login flow resists scripting, the admin check is done
  by hand and the screenshot attached, and the quickstart says which it was.
