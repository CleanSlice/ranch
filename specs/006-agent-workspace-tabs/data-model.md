# Phase 1 — Data Model: Agent workspace

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-20

**No server-side entity changes.** This feature adds no table, column, DTO or endpoint. The
API's `IAgentData` already carries everything the rail and the panel display, and the
`@Public()` SSE stream already carries live pod state. What follows is the *view* model — the
shapes the new components pass between themselves — plus the two client-side preferences the
feature introduces.

## Existing entities consumed (unchanged)

### `IAgentData` — `admin/slices/agent/agent/domain/agent.types.ts:58`

Fields this feature reads. Everything else on the record is untouched.

| Field | Type | Used for |
|-------|------|----------|
| `id` | `string` | Rail identity, route param, panel identity |
| `name` | `string` | Rail label, initials, panel header |
| `status` | `AgentStatusTypes` | Rail status dot + label; `'running' \| 'pending' \| 'deploying' \| 'failed' \| 'stopped'` |
| `createdAt` | `string` (ISO) | Rail timestamp in **admin** (FR-002) |
| `updatedAt` | `string` (ISO) | Rail timestamp in **app**; admin landing fallback ordering |
| `isAdmin` | `boolean` | Rail admin marker; **admin landing agent selection** (FR-007) |
| `templateId` | `string` | App rail secondary line (as on today's card) |
| `knowledgeIds` | `string[]` | Feeds the Knowledge count via `useAgentKnowledges` |
| `resources` | `IAgentResources` | Panel identity block (was a table column) |
| `statusReason` | `string \| null` | Panel identity block when `status === 'failed'` |

### `IAgentPodStatus` — via `useAgentStatusStore.statuses[agentId]` (admin only)

Live pod phase from the SSE stream. The rail prefers it over `agent.status` when present, the
same precedence `rancher/Provider.vue` already uses:

```ts
const pod = agentStatusStore.statuses[agent.id];
const live = pod ? (pod.phase === 'Running' && pod.ready) : agent.status === 'running';
```

### `IClusterCapacityData`

`freeAgentSlots` and `totalAgentSlots`, already fetched by both consoles. Moves from the
deleted table header / cards header into the workspace top bar (FR-009). Owner/Admin only —
the endpoint is `@Roles(Owner, Admin)`, so non-privileged app users must not trigger it.

---

## View models introduced

These are TypeScript types local to the `agent` slice — no persistence, no serialisation.

### `RailEntry`

One row in the vertical agent list. Derived, never stored.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | |
| `name` | `string` | Truncated with `title` on hover for long names (edge case) |
| `initials` | `string` | 1–2 uppercase chars; falls back to the id's first chars when the name is empty — same derivation as today's `Card.vue` |
| `status` | `AgentStatusTypes` | Reconciled: live pod state where available, DB row otherwise |
| `statusTone` | `{ dot: string; text: string; pulse: boolean }` | Presentation only; `pulse` true for `running`/`deploying`/`pending` |
| `timestamp` | `string` (ISO) | `createdAt` in admin, `updatedAt` in app |
| `isAdmin` | `boolean` | Renders the Ranch-admin marker |
| `isActive` | `boolean` | Exactly one entry true (FR-003) |

**Derivation rule**: `RailEntry[]` is a `computed` over the agent list, in the list's existing
order, filtered by the search term (FR-023, case-insensitive substring on `name`). It carries
**no action handlers** — FR-002 forbids per-row controls.

### `SettingsSection` (admin only)

Replaces `AGENT_TABS` in `components/agent/item/tabs.ts`. The `chat` entry is **removed** —
the chat is the canvas, not a section — leaving the eight sections of FR-012.

| Field | Type | Notes |
|-------|------|-------|
| `value` | `AgentSettingsSection` | `'overview' \| 'knowledge' \| 'files' \| 'secrets' \| 'env' \| 'channels' \| 'chats' \| 'paddock'` — **unchanged string values**, which is what keeps old `?tab=` links working (FR-016) |
| `title` | `string` | English only; `admin` is not localised |
| `desc` | `string` | One line, as today |
| `countKey` | `keyof SectionCounts \| null` | `null` for sections with nothing to count (Overview, Environment, Chats, Paddock) |

Order is the display order and matches the current tab order minus `chat`.

A `SettingsSection` is **navigation metadata only** — a label, a description and a count. It
carries no component reference and no content; the canvas maps a section value to the component
that renders it (see [contracts/components.md](./contracts/components.md)).

### `SectionCounts` (admin only)

Produced by `useAgentSectionCounts(agentId)`. Every field is independently resolved and
independently failable.

| Field | Type | Source | `null` when |
|-------|------|--------|-------------|
| `knowledge` | `number \| null` | `useAgentKnowledges().resolved.length` | in flight, or template/knowledge fetch failed |
| `files` | `number \| null` | `useAgentFileStore().list(id).length` | in flight, or S3 unreachable |
| `secrets` | `number \| null` | `agentSecret` store list length | in flight, or the secret provider errored |
| `channels` | `number \| null` | `useAgentChannelStore().fetchForAgent(id).length` | in flight, or fetch failed |

**Invariants**:
- Never fetched until the panel is open (R5).
- `null` renders as *nothing* — never `0`, never a spinner, never an error badge. `0` is a
  real, distinct value meaning "none attached".
- Keyed by `agentId`; switching agents discards the previous agent's counts.

### `WorkspaceSelection`

The workspace's addressable state — reflected in the URL, not in a store.

| Field | Source of truth | Notes |
|-------|-----------------|-------|
| `agentId` | route param `/agents/:id` | Changing it is a router navigation, which is what gives Back/Forward for free (FR-004) |
| `section` | query param `?tab=<value>` | **Drives the canvas mode**: `undefined` ⇒ the canvas shows the conversation; a section value ⇒ the canvas shows that section. Legacy `chat` and unknown values normalise to `undefined` and are stripped from the URL. Preserved across agent switches. |
| `panelOpen` | `localStorage`, overridden to `true` while `section` is set | Visibility of the *navigator*, independent of what the canvas shows. See preferences below. |

---

## Client-side preferences

Two keys, both `localStorage`, both non-critical — a browser with storage disabled gets the
defaults and everything still works. Full shapes in
[contracts/preferences.md](./contracts/preferences.md).

### `agent:settingsPanelOpen` (admin)

- **Value**: `'1' | '0'`
- **Absent ⇒ open.** This is the FR-013 default, and it is deliberately encoded as
  *absence means open* rather than writing `'1'` on first visit — a fresh browser and a
  browser that has never touched the toggle behave identically.
- Written only when the operator explicitly collapses or reopens the panel.
- Not per-agent: it is a habit, not a property of an agent.

### `agent:lastOpened` (app)

- **Value**: agent `id` string
- Written on every successful workspace open (FR-020).
- **Validated on read**: if the id is not in the user's visible agent list it is discarded and
  the fallback chain runs (first `running` → first in list). This is what makes a deleted or
  newly-hidden agent a non-event rather than a dead landing.
- Per browser, not synced — a second device falls back to first-running (spec Assumptions).

---

## State transitions

Two independent pieces of state, deliberately not folded into one. The **canvas mode** says
what the middle column shows; the **panel state** says whether the navigator is visible. An
operator can close the navigator while a section is open, and the section stays open.

### Canvas mode

```
   ┌───────────────┐   click a section in the panel   ┌──────────────────┐
   │ CONVERSATION  │ ───────────────────────────────► │  SECTION <value> │
   │  (default)    │ ◄─────────────────────────────── │                  │
   └───────────────┘   "‹ Chat" / clear ?tab=         └──────────────────┘
          ▲                                                    │
          │  the chat is never unmounted — it is hidden with    │
          └────  v-show and comes back with its transcript  ────┘
```

Switching agents keeps the mode: if the canvas was showing Environment, it shows Environment
for the newly selected agent.

### Panel (navigator) visibility

```
              first visit (no stored key)
                        │
                        ▼
                  ┌───────────┐   operator collapses    ┌────────────┐
                  │   OPEN    │ ──────────────────────► │  COLLAPSED │
                  │ (default) │ ◄────────────────────── │            │
                  └───────────┘   operator reopens      └────────────┘
                        ▲                                      │
                        │        ?tab=<section> in URL         │
                        └──────────────────────────────────────┘
                          (forces open, does not write the pref)
```

The forced-open transition on a deep link deliberately **does not** persist: following someone
else's `?tab=env` link should not permanently change an operator who prefers the panel closed.

Agent runtime state (`running`/`deploying`/`failed`/…) is **not** owned here — it stays with
`useAgentLifecycle` and the SSE store, and the rail is a read-only consumer of it.
