# Contract — Components

**Feature**: [../spec.md](../spec.md) | **Date**: 2026-08-20

Props, emits and reuse boundaries for the workspace. Component names follow Nuxt's
path-based auto-import in each slice: `components/agent/workspace/Rail.vue` →
`<AgentWorkspaceRail>`.

## Admin — `admin/slices/agent/agent/components/agent/`

### `<AgentWorkspaceProvider>` — `workspace/Provider.vue`

The shell. Owns the layout tier, the panel's open state, and the URL ↔ state wiring.

```ts
defineProps<{ id: string }>()
```

Renders: `<AgentWorkspaceTopBar>` · `<AgentWorkspaceRail>` · `<AgentWorkspaceMain :key="id">` ·
`<AgentSettingsPanel>` (docked `<aside>` at ≥1700px, `<Sheet>` below — R1).

**Invariants**
- The `:key` sits on `Main`, never on the provider or the rail (R4) — the rail must survive an
  agent switch.
- Owns exactly one `useAsyncData('admin-agents')` for the rail; `Main` owns the per-agent
  fetch.
- Layout tier comes from `useMediaQuery('(min-width: 1700px)')` (`@vueuse/core`, already a
  dependency).

### `<AgentWorkspaceRail>` — `workspace/Rail.vue`

```ts
defineProps<{
  agents: IAgentData[];
  activeId: string;
  pending: boolean;          // → skeleton rows, FR-027
}>()
defineEmits<{ select: [id: string] }>()
```

Owns the FR-023 search field and its "nothing matches" state. Reconciles each agent's status
against `useAgentStatusStore.statuses` before rendering. Emits `select`; it does **not**
navigate — routing is the provider's job, which keeps the rail testable and reusable.

### `<AgentWorkspaceRailItem>` — `workspace/RailItem.vue`

```ts
defineProps<{ entry: RailEntry }>()   // RailEntry — see ../data-model.md
```

Presentational only. **No action controls** (FR-002) — no restart, no dropdown, no delete.

### `<AgentWorkspaceTopBar>` — `workspace/TopBar.vue`

Occupies the row where `← Back to agents` sits today (FR-009).

```ts
defineProps<{ capacity: IClusterCapacityData | null }>()
```

Renders the `New agent` link and the `N slots free` badge plus its cluster-full warning.
`capacity` is `null` for anyone who cannot fetch it — the endpoint is `@Roles(Owner, Admin)`,
so the badge simply does not render rather than producing a 403.

### `<AgentWorkspaceMain>` — `workspace/Main.vue`

```ts
defineProps<{ id: string }>()
```

Everything per-agent: the pending-restart banner, the compact agent header (avatar, name,
status pill, `Manage agent` toggle), the usage strip, and `<AgentWorkspaceCanvas>`. Mounted
under `:key="id"`, so all of it is torn down and rebuilt on an agent switch (FR-026).

**Reuse contract**: `useAgentLifecycle(id, agent, refresh)` is called here, unchanged. It
already owns the SSE connection, restart/stop/start, the pending-restart banner and the chat
overlay — none of that logic is rewritten, it only moves.

### `<AgentWorkspaceCanvas>` — `workspace/Canvas.vue`

The middle column, in one of two modes (R2).

```ts
defineProps<{
  agent: IAgentData;
  apiUrl: string;
  section: AgentSettingsSection | null;   // null ⇒ chat mode
}>()
defineEmits<{ 'back-to-chat': [] }>()
```

**The one invariant that matters**: the chat branch is toggled with `v-show`, **never**
`v-if`. Unmounting it would drop the websocket, lose the transcript and scroll position, and
reset the restart overlay — FR-014 and SC-004a exist to forbid exactly that. The section
branch, by contrast, *is* `v-if` — sections should mount fresh and unmount when left, which is
the remount-on-activate behaviour `TabsContent` gives them today.

When a section is open the canvas also renders a return control (`‹ Chat`) and the section's
name, so the operator always knows where they are and how to get back.

### `<AgentSettingsPanel>` — `settings/Panel.vue`

```ts
defineProps<{
  agent: IAgentData;
  apiUrl: string;
  section: AgentSettingsSection | null;   // expanded section, from ?tab=
}>()
defineEmits<{
  'update:section': [AgentSettingsSection | null];
  close: [];
  'agent-updated': [IAgentData];          // forwarded from the Overview section
}>()
```

Three parts: identity block (avatar, name, id, status, resources) · the **navigator list** of
eight sections · the lifecycle footer (`Stop`/`Start`, `Restart`, `Edit`, and `Delete` behind a
confirm — FR-009, FR-017).

**Invariants**
- The panel holds **no section content** (FR-018). It emits `update:section`; the canvas
  renders. This is what keeps it at 320px and keeps the eight section components untouched.
- It renders identically in its docked and overlay hosts. The host decides placement and
  width; the panel decides nothing about where it lives.
- It stays visible while a section is open, with that section marked as current — the operator
  must be able to reach another section, or the conversation, in one click (FR-014).

### `<AgentSettingsNavItem>` — `settings/NavItem.vue`

```ts
defineProps<{
  section: SettingsSection;      // see ../data-model.md
  count: number | null;          // null ⇒ render no count at all, never "0"
  current: boolean;              // this section is what the canvas is showing
}>()
defineEmits<{ select: [] }>()
```

A row, not a container: title, one-line description, count, and a chevron. It renders no
section content — that is the canvas's job.

### Reused verbatim — the eight sections

These components are **not rewritten** and **not restyled** (FR-012, SC-004). They move from
`TabsContent` into the canvas's section branch with their props unchanged, and the canvas gives
them roughly the width they have today, which is the whole point of R2:

| Section | Component | Props today |
|---------|-----------|-------------|
| Overview | `<AgentOverviewTab>` | `agent`, `apiUrl`, `@agent-updated` |
| Knowledge | `<AgentKnowledgeTab>` | `agent` |
| Files | `<AgentFileProvider>` | `id` — the parent's `Card` wrapper and its explanatory copy move into the canvas's section header |
| Secrets | `<AgentSecretProvider>` | `id` — same wrapper note |
| Environment | `<AgentEnvTab>` | `agent-id` |
| Channels | `<AgentChannelProvider>` | `agent-id` |
| Chats | `<ChatListProvider>` | `agent-id` |
| Paddock | `<AgentPaddockTab>` | `agent-id` |

**Changed**: `components/agent/item/tabs.ts` drops the `chat` entry and gains `countKey` per
section. The eight `value` strings stay byte-identical — that is the `?tab=` compatibility
guarantee.

**Deleted**: `components/agent/list/Provider.vue` (the table). Before deleting, every
capability in it must be accounted for — see [../plan.md](../plan.md) Risk 2 and quickstart
step 10.

### `useAgentSectionCounts(agentId)` — `composables/useAgentSectionCounts.ts`

```ts
function useAgentSectionCounts(agentId: string, enabled: Ref<boolean>): {
  counts: ComputedRef<SectionCounts>;   // every field number | null
}
```

Fires nothing until `enabled` is true (the panel is open). Each of the four fetches resolves
independently and catches to `null`.

### `useSettingsPanel()` — `composables/useSettingsPanel.ts`

Owns the open/closed preference, the `?tab=` read/write, and the forced-open rule. See
[preferences.md](./preferences.md) and [routes.md](./routes.md).

## App — `app/slices/agent/components/`

### `<AgentWorkspaceProvider>` — `agentWorkspace/Provider.vue`

```ts
defineProps<{ id: string }>()
```

Rail + chat. **No settings panel, no sections** (FR-019). Writes `agent:lastOpened` on every
successful open. Refreshes the agent list every 30s (R3).

### `<AgentWorkspaceRail>` / `<AgentWorkspaceRailItem>` — `agentWorkspace/`

Same prop shape as the admin pair, hand-rolled Tailwind rather than shadcn (R8). The status
tone map, the initials derivation and the relative-time bucketing move over from
`agentList/Card.vue` rather than being rewritten.

**Deleted**: `agentList/Card.vue`, `agentList/Provider.vue`.

**Edited**: `agentChat/Provider.vue` — keeps all its logic (restart, transitional polling,
overlay stages, status pill) and loses only its `← Back to agents` link and its own outer
height wrapper, both of which the workspace now owns.

### i18n

Every new app string is an English key in `app/slices/agent/i18n/locales/en.json`, used as
`$t('...')` in the template, with `ru.json` generated by `bun run i18n:sync` (FR-022,
`docs/i18n.md`). Copy that depends on state travels as a key, not as text. Expected new
groups: `rail.*` (search placeholder, no-match line, status column) reusing the existing
`status.*` and `relative_time.*` keys rather than duplicating them.

`admin` adds no i18n — it is English-only by policy.
