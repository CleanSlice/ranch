# UI contract: profile page "Pass" (CLEAN-217)

What a person sees and what the browser check asserts. Visual reference:
`Claude outputs/profile/profile-a-propusk.png`; exact colours and sizes from
`profile-a-propusk.html`, translated to Tailwind and the `.dark` theme tokens.

## Route and guard

- `/profile`, default console layout (not flush).
- Signed out → `/login?redirect=/profile`; after sign-in back to `/profile`.

## Header pill (`common/components/layout/Provider.vue`)

- One `<a href="/profile">` holding the name (or email) and the role badge;
  at least 44 px tall; `title` = email.
- On `/profile`: copper border, `aria-current="page"`. Elsewhere: no
  `aria-current`.
- Below `sm`: the name is replaced by the personal sign (24 px) with
  initials; the badge stays.
- Language select and Log out: unchanged, same order.

## Layout

- ≥ 1024 px: two columns, pass 400 px, back column fills the rest.
- < 1024 px: one column, pass first (max 400 px, centred).
- No horizontal scroll at 1440, 1024, 768, 390, 360.

## Pass (`Pass.vue`, `Sign.vue`, `Fleet.vue`)

| Element | Content | Hook |
|---|---|---|
| Lanyard, clip, slot | decorative, `aria-hidden` | — |
| Brand row | `LandingBrandLogo` + `profile.pass` | — |
| Sign | ring copper → lavender, dashed orbit with a copper dot, initials, copper arc; `role="img"`, `aria-label` = `profile.sign_label` with the name | `[data-profile-sign]` |
| Name | `<h1>`, wraps to two lines | `[data-profile-name]` |
| Role | upper case, DotGothic16, copper | `[data-profile-role]` |
| Registry no. | `profile.registry` + `7F3A·9C1E`, DotGothic16 | `[data-profile-registry]` |
| Account status | dot + word | `[data-profile-status]` |
| Perforation | dashed rule, two notches, `aria-hidden` | — |
| Fleet header | `profile.fleet` · `profile.poll` | — |
| Counters | agents, running, slots free (third only with capacity) | `[data-fleet-agents]`, `[data-fleet-running]`, `[data-fleet-free]` |
| Scale | marks (≤ 40) or bar; `role="img"`, `aria-label` = `profile.scale_label` with used, free, total | `[data-fleet-scale]` |
| Caption | `profile.slots_used` | — |

The foil highlight never sits under text.

## Back (`Account.vue`, `Capabilities.vue`, `Session.vue`)

**Account** — `<dl>`: Name (only if present), Email, ID + copy button
(`aria-label` = `profile.copy_id`), Role, Console version (only if present).
After a copy: `profile.copied` for 2 s inside an `aria-live="polite"` region.
Hook: `[data-copy-id]`, `[data-copied]`.

**Capabilities** — `<ul>`, five `<li>`, in the order of spec FR-010:

| State | Icon | Text | Right caption |
|---|---|---|---|
| `yes` | green check | normal | roles it is open to |
| `elsewhere` | lavender arrow out | normal | roles + "in the admin console" |
| `locked` | lock | muted | "needs the administrator role" / "owner only" |

Hook: `li[data-cap][data-state]`.

**Session** — green dot, `profile.session`, a copper link "Go to agents"
(`/agents`) and a "Log out" button calling the same logout as the header.
Both ≥ 44 px.

## Motion

- Tilt ≤ 6° per axis, `transform` only, only under
  `(hover: hover) and (pointer: fine)` and without reduced motion.
- No `animation` with `infinite` anywhere under the page root.
- Reduced motion: computed `transform` of the pass is `none` after moving the
  pointer over it.

## i18n keys (`profile` slice)

From the brief: `pass`, `registry`, `account`, `status_active`,
`status_invited`, `status_disabled`, `fleet`, `poll`, `agents` (plural),
`running`, `slots_free` (plural), `slots_used`, `back`, `copy_id`, `copied`,
`version`, `can`, `session`, `to_agents`.

Added: `name`, `email`, `id`, `role`, `sign_label`, `scale_label`,
`cap.create`, `cap.control`, `cap.slots`, `cap.share`, `cap.users`,
`cap_roles.operators`, `cap_roles.all`, `cap_roles.owner_admin_console`,
`cap_lock.needs_admin`, `cap_lock.owner_only`.

Reused: `role.*`, `auth.sign_out`.

## Browser check (`specs/028-app-profile/e2e/profile.mjs`)

Owner (seeded login): header pill → `/profile`, `aria-current`; values equal
the API's `/auth/me`; registry number equals the rule applied to the id; copy
→ "Copied" appears and disappears; five capabilities with the Owner states;
counters equal `/agents` and `/agents/capacity`; scale label carries the three
numbers; "Go to agents" and "Log out" work; signed out → redirect with the
return address. States forced through route interception: role Admin, role
User (no third counter, three locks), capacity failing, zero agents, a
two-line name, no name. Screenshots at 1440, 1024, 768, 390 and one under
reduced motion; no horizontal scroll at each width.
