# Data Model: App profile page "Pass" (CLEAN-217)

Nothing is stored or sent. The page reads two existing stores and derives the
rest.

## Read

| Source | Field | Used for | When absent |
|---|---|---|---|
| `authStore.user` | `name` | heading, account row, initials | email stands in; the Name row is not shown |
| | `email` | account row, name fallback | — (always present when signed in) |
| | `id` | account row + copy, registry number | — |
| | `role` | role line, account row, capabilities | unknown value shown as received |
| | `status` | account status dot + word | unknown value shown as received, neutral colour |
| runtime config | `public.ranchVersion` | Console version row | row not rendered |
| `agentStore.agents` | length | "agents" counter | `0` is a real value |
| | `status === 'running'` count | "running" counter | `0` is a real value |
| `agentStore.capacity` | `freeAgentSlots`, `usedAgentSlots`, `totalAgentSlots` | third counter, scale, caption | third counter, scale and caption not rendered |

Capacity is requested only for Owner / Admin (`useAgentFleet`, research R3).

## Derived (pure, tested)

| Value | Function | Rule |
|---|---|---|
| Registry number | `registryNumber(id)` | first 8 alphanumerics, upper case, `XXXX·XXXX`; fewer → what exists; none → block hidden |
| Initials | `agentInitials(name, email)` (agent slice) | first letters of up to two words |
| Capabilities | `capabilitiesFor(role)` | table in spec FR-010; states `yes` / `elsewhere` / `locked` |
| Slot scale | `slotScale(capacity)` | `null` → nothing; total ≤ 40 → marks; > 40 → bar |
| Status tone | in `Pass.vue` | `active` green, `invited` amber, `disabled` rose, other neutral; always with the word |

## State on the page

| State | Where | Lifetime |
|---|---|---|
| "Copied" flag | `Account.vue` | 2 s after a successful copy |
| Tilt variables | `Pass.vue` (CSS custom properties) | while the pointer is over the pass |

No `localStorage`, no route query.
