# UI contract: agent console (`/agents/:id`)

Holds `app/slices/agent/components/agent/workspace/*`, `agent/chat/Provider.vue` (`compact`), `composables/useAgentControls.ts`, `utils/*` and the store to the spec.

## Layout

- Root `.agent-workspace` is `h-[calc(100vh-3.5rem-1px)]` (header + border) and owns the height.
- `≥ lg (1024)`: left pane = map (Orbit or Drum) **or** the Rail list when `view === 'list'`; right pane = cockpit `w-[460px] xl:w-[520px]` with `AgentWorkspaceSheet` above `AgentChatProvider :compact="true"`.
- `< lg`: the view switch is hidden; "Switch agent" button opens the Rail as an overlay; chat is full width; the Sheet starts collapsed unless `agent:sheetOpen === '1'`.
- Console theme: `useHead({ htmlAttrs: { class: 'dark' } })` in `layout/Provider.vue`; fonts via `useBrandFonts()`.

## Toolbar (Orbit and Drum share it)

| Element | Contract |
|---|---|
| View switch | `role="tablist"` `aria-label="$t('orbit.view_label')"`, three `role="tab"` buttons `orbit.view_orbit/drum/list`, `aria-selected`; writes `localStorage['agent:view']` |
| Search | `input[type=search]` `aria-label="$t('rail.search')"`, `kbd ⌘K` decorative; filter = case-insensitive substring on `name`; **Enter** opens the first match (`navigateTo('/agents/<id>')`), **Esc** clears and blurs; `Cmd/Ctrl+K` anywhere focuses it (or the Rail's `[data-agent-search]` when the list is shown) |
| Legend | one row, `LEGEND_STATUSES` order (running, deploying, pending, failed, stopped), each `status.*` label + count, only non-zero statuses; `font-mono text-[10.5px]` |
| Footer | `list.slots_free` with `{ count: freeAgentSlots }` (owners/admins only), `Create agent` → `/agents/new`; disabled when `freeAgentSlots === 0` |

Search is transient: a reload shows every node.

## Orbit (`AgentWorkspaceOrbit`)

Props `agents`, `activeId`, `pending` (initial only), `search`. Emits `select(id)`.

- Rings: `orbitLayout()` (see data-model) on an ellipse `rx = max(120, w/2 − 110)`, `ry = max(100, h/2 − 64)` measured by `ResizeObserver`. Rings and link lines are SVG, `aria-hidden`.
- Nodes: `<button data-orbit-node :data-active>` 40 px (active 48 px), initials inside, label (name + status) outside the ring on the far side from the hub; `aria-label` = "<name>, <status label>"; border colour from `agentStatusMeta`; `.is-alarm` pulses red; `.is-pulse` breathes.
- Hub: `<button>` with `LandingBrandLogo variant="mark"`, `aria-label="$t('rail.admin_agent')"`, opens the admin agent.
- Keyboard: Tab into the map; `ArrowRight/Down` next node, `ArrowLeft/Up` previous (wrapping) in orbit order; Enter/Space = the button's own activation. Focus ring visible.
- Search: non-matching nodes `opacity .25`, matching stay; no match → `rail.empty`-style hint over the map.
- Poll: nodes keyed by `agent.id`; a refresh with unchanged statuses changes no node's ring or angle.

## Drum (`AgentWorkspaceDrum`)

Props as Orbit. Container `role="listbox"` `tabindex="0"` `aria-activedescendant="<card id>"`, cards `role="option"` with `aria-selected` for the centred card; cards more than 2 steps from the front are `aria-hidden`.

| Input | Effect |
|---|---|
| wheel (larger of `deltaX`/`deltaY`; `deltaMode` 1 → ×32, 2 → ×400) | `target += delta / 90`, settle after **110 ms** |
| pointer drag (`setPointerCapture`, > 4 px = dragged) | `target = start − dx / 224`, settle on release |
| `ArrowRight/Down`, `ArrowLeft/Up` | ±1 card |
| `PageDown/PageUp` | ±5 |
| `Home/End` | first / last |
| `Enter` / `Space` / click on the **front** card | `emit('select')` |
| click on a side card | turn to it |

Geometry: `rotateY(index·30°) translateZ(RADIUS)`, `RADIUS = (112 + 10) / tan(15°)`; front card scale 1, opacity 1; others smaller and dimmer. Reduced motion: position snaps.

## Sheet (`AgentWorkspaceSheet`)

Props `agent`, `pending`, `canManage`. Header line always visible: initials, name, status pill, class (`sheet.class_admin` / `sheet.class_agent`), fold/unfold button (`sheet.fold` / `sheet.unfold`, `aria-expanded`). Body when open:

| Row | Source |
|---|---|
| `sheet.template` | `agent.templateId` (mono, truncated, `title`) |
| `sheet.resources` | `resources.cpu · resources.memory` |
| `sheet.access` | `sheet.access_public` / `sheet.access_private`; origins list via `sheet.origins` when public |
| `sheet.age` | `useFormat().date(createdAt)` · `sheet.updated` with `$t(relativeTime(updatedAt).key, { count })` |

Actions (only when `canManage`): `chat.restart` (→ `chat.restarting` while busy), `sheet.stop` / `sheet.start` by `canStart` (→ `sheet.stopping` / `sheet.starting`), `SharePanelProvider`, `BridleChatNewChat`. All disabled while `transitioning`. Failure: `chat.restart_failed` / `sheet.stop_failed` / `sheet.start_failed` with the server message appended as received; a 401 shows nothing here (Session-ended dialog owns it).

## Store (`useAgentStore`)

```ts
stop(id):  rollback = patch(id, { status: 'stopped' });   await service.stop(id)  → upsert; catch → rollback(), rethrow
start(id): rollback = patch(id, { status: 'deploying' }); await service.start(id) → upsert; catch → rollback(), rethrow
```

`restart` as on `main`. `void fetchCapacity()` after either. No component or composable flips a status itself.

## Polling

List `fetchAll` every 30 000 ms; capacity every 30 000 ms (owners/admins); open agent `fetchById` every 3 000 ms while `pending` or `deploying` (existing in `agent/chat/Provider.vue`). Unchanged by this feature.

## Rail / List view

Existing `AgentWorkspaceRail` + `RailItem` restyled (pill search, status dot colours from `agentStatusMeta`, same `data-agent-search` hook). Row renders from the store record, so a Sheet action changes the row in the same frame.
