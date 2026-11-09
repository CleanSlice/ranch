# Research: App profile page "Pass" (CLEAN-217)

Phase 0 of [plan.md](./plan.md). Checked against
`feat/CLEAN-215-app-console-redesign` on 2026-11-10. The brief was written
against the reference worktree; where it and this branch differ, the branch
wins and the difference is noted.

## R1. Own slice, not `user/auth`

**Decision**: `app/slices/profile`, alias `#profile`.

**Rationale**: `user/auth` owns sign-in, the session and the gate; it has no
i18n file of its own and no reason to know about agents. The page needs the
agent store, capacity and status colours. The brief allows this move ("if the
dependency contradicts the conventions, make a separate slice and say so").
The only existing cross-slice reads of the agent slice are from `common`'s
landing hero, through the store; the profile does the same through public
surfaces.

**Alternatives considered**: `user/auth/pages/profile.vue` (rejected: auth →
agent dependency); `user/profile` as a sub-slice of `user` (rejected: `user`
is a twin slice and admin has no counterpart, which would read as drift).

## R2. Data the page has

`IAuthUser` (`app/slices/user/auth/domain/auth.types.ts`): `id`, `name`,
`email`, `role: UserRoleTypes`, `status: string`. The server's
`UserStatusTypes` is `'active' | 'invited' | 'disabled'`. `authStore.role`
and `hasRole()` exist. Console version:
`useRuntimeConfig().public.ranchVersion` (already used by the landing
footer). Fleet: `agentStore.agents`, `agentStore.capacity`
(`freeAgentSlots`, `usedAgentSlots`, `totalAgentSlots`, `null` on any
failure or for non-operators). All as the brief says.

`name` is typed as a string but the header already treats it as possibly
empty (`name ?? email`); the page uses `name?.trim() || email`.

## R3. One fleet poll, shared

**Decision**: new `app/slices/agent/composables/useAgentFleet.ts`:
`useAsyncData('agents', () => agentStore.fetchAll())`, a 30 s `refresh`
interval, and for Owner / Admin `fetchCapacity()` at mount and every 30 s;
timers cleared on unmount; returns `{ pending, refresh, agents, capacity,
canManage }`. `workspace/Provider.vue` switches to it (same key, same
cadence, same role gate — a move, not a change); the profile page calls it
too.

**Rationale**: the brief asks for "the same key and the same refresh as the
workspace". Copying 20 lines of timers into a second slice is how the two
would drift; the agent slice owns the store, so it owns the poll
(constitution I: cross-slice needs go through the owning slice's surface).

**Risk and guard**: the workspace is the busiest screen. Guard: the existing
`specs/026-app-console-redesign/e2e/console.mjs` is re-run after the move.

**Alternatives considered**: duplicate the timers in the page (rejected,
above); a store-level poll (rejected: polling is page lifetime, not store
lifetime — docs/state.md keeps fetch orchestration out of the store).

## R4. "Assign roles and delete users" is Owner-only — confirmed

`api/src/slices/user/user/user.controller.ts`: `@Put(':id/role')` and
`@Delete(':id')` both carry `@Roles(UserRoleTypes.Owner)`; the rest of the
controller is `@Roles(UserRoleTypes.Admin)`. FR-011 is satisfied: the fifth
row stays, marked "in the admin console" for Owner and locked "owner only"
for Admin and User.

The first three rows match `hasRole(Owner, Admin)` in
`agents/create.vue`, `workspace/Provider.vue` (capacity, create) and
`chat/Provider.vue` (controls). Row four (share, new chat) has no role gate
in `Sheet.vue` ("whoever can open the agent may share it").

## R5. Header pill

Today: a `<span>` with the name (hidden below `sm`), a role badge `<span>`,
and the Log out button. Becomes one `<NuxtLink to="/profile">` pill
containing name (or email) and the role badge, `min-h-11`, with the copper
border and `aria-current="page"` when `route.path === '/profile'` (the
header's own `navActive` helper from CLEAN-215). Below `sm`, where the name
is hidden today, the pill shows the personal sign with initials plus the
role badge, so the page is reachable on a phone (the brief does not say;
without this the only entry on mobile would be typing the address). The
language select and Log out are untouched.

## R6. Twin check (admin)

- `common` header: admin's `layout` has a sidebar with a user block
  (`Dmitriy Zhuk / email` at the bottom) and no top-bar name; nothing to
  change. Admin has no profile page and this ticket adds none.
- `user/auth` guard: admin's guard protects every route but the auth pages;
  no prefix list to extend.
- `agent` workspace: admin's workspace is a different component fed by an
  SSE status stream; it has no 30 s poll to share.

Stated in the PR.

## R7. Pure utilities

- `registryNumber(id)`: strip everything but `[A-Za-z0-9]`, take the first
  eight, upper-case, join groups of four with `·`; fewer than eight → what
  there is (one group if ≤ 4); empty → `''` and the block is not rendered.
- `capabilitiesFor(role)`: five items `{ key, state: 'yes' | 'elsewhere' |
  'locked', lockKey?: 'needs_admin' | 'owner_only', rolesKey }`. Unknown
  role is treated as User for the three operator rows and row five, and
  `yes` for row four only if the role is one of the three known ones;
  otherwise every row is locked (an `Agent` role token should not be told
  it can share).
- `slotScale(capacity)`: `null` → `null`; total ≤ 40 → `{ kind: 'marks',
  used, total }`; total > 40 → `{ kind: 'bar', ratio }`; `used` clamped to
  `[0, total]`; total ≤ 0 → `null`.
- Initials: reuse `agentInitials(name, email)` from
  `#agent/utils/agentStatus` (the brief: "count them the same way").

Regexes go into files with Write/Edit, never a heredoc (memory note).

## R8. Motion

`Pass.vue` tracks the pointer with one `pointermove` listener on the card,
writes `--rx` / `--ry` (±6°) and `--fx` / `--fy` (foil offset) as CSS
variables through `requestAnimationFrame`; the card has
`transform: perspective(900px) rotateX(var(--rx)) rotateY(var(--ry))` and a
short `transition` back to flat on leave. Enabled only when
`matchMedia('(hover: hover) and (pointer: fine)')` matches and
`prefers-reduced-motion` does not; otherwise no listener is attached. No
keyframes on the page.

## R9. i18n and wording

Keys in `profile.*` as in the brief's table, plus what the table leaves out
(capability labels, lock captions, role lists, `name` / `email` / `id` /
`role` row labels, the scale's `aria-label`, `sign_label`). Plurals:
`profile.agents`, `profile.slots_free` with `|` branches (three in English,
four in Russian, as `list.slots_free`). Role names reuse `role.*` from
`common`. `auth.sign_out` is reused for Log out. `account.*` is taken by the
sign-in form and is not touched. After `i18n:sync`, the Russian is aligned
with the mock-up (for example "Пропуск", "оборот пропуска", "Флот
установки").
