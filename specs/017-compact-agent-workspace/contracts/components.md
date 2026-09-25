# Contract: components (admin)

Props and emits of every new or changed component, so tasks can be split by file and the
twin check for shared slices (`share`, `bridle`) is explicit. Auto-import names follow the
slice path convention.

## New

### `AgentWorkspaceSettingsHub` — `agent/agent/components/agent/workspace/SettingsHub.vue`

| Prop | Type | Notes |
|------|------|-------|
| `sections` | `readonly ISection[]` | `SECTIONS` in hub order |
| `counts` | `SectionCounts` | from `useAgentSectionCounts` |

Emits `open: [value: SectionValue]`. Renders a grid (`grid-cols-1 md:grid-cols-2
xl:grid-cols-3 gap-3`) of `AgentWorkspaceSectionCard`. Cards are `<button>`s (focusable,
Enter opens).

### `AgentWorkspaceSectionCard` — `…/workspace/SectionCard.vue`

| Prop | Type | Notes |
|------|------|-------|
| `section` | `ISection` | icon tile, title, desc |
| `count` | `number \| null` | `null` → muted "…" placeholder; number → chip |

Emits `select: []`.

### `AgentWorkspaceSectionFrame` — `…/workspace/SectionFrame.vue`

| Prop | Type | Notes |
|------|------|-------|
| `section` | `ISection` | title in the row |

Emits `back: []` (host calls `setTab('settings')`). One row: ghost button "← Settings",
section title. Slot: the section content.

### `AgentLogsBar` — `agent/agent/components/agent/logs/Bar.vue`

| Prop | Type | Notes |
|------|------|-------|
| `agentId` | `string` | |
| `restarting` | `boolean` | same signal the side panel got (`restartUnderway`) |
| `firstStart` | `boolean` | `agent.launchContext === 'initial'` |

No emits. Internal `expanded` ref. Collapsed: mounts `useAgentLogs(agentId)` and renders
one row from `summarizeAgentLogs(logGroups)`. Expanded: mounts `<AgentLogsPanel closable
…>` and nothing else; the panel's `close` collapses. The host mounts the bar only while
the chat is active.

### `AgentStatusDot` — `agent/agent/components/agent/status/Dot.vue`

| Prop | Type |
|------|------|
| `status` | `AgentStatusTypes` |
| `statusReason` | `string \| null` |
| `deployVerb` | `'started' \| 'restarted' \| null` |
| `deployAgo` | `string \| null` |
| `deployHintTitle` | `string \| undefined` |

Renders the dot (tone from exported `TONE`), wrapped in the vendored `Tooltip`. Positioned
by the host (`absolute -bottom-0.5 -right-0.5` inside the avatar's `relative` box).

### `UsageLine` — `usage/components/usage/Line.vue`

| Prop | Type |
|------|------|
| `agentId` | `string` |

Emits `details: []`. Renders muted text for loading / error / empty, a text button for
ready; the button toggles a reka-ui popover with the six figures and a Details button.

## Changed

### `AgentWorkspaceTabs` — `…/workspace/Tabs.vue`

| Prop | Type | Change |
|------|------|--------|
| `active` | `'chat' \| 'settings'` | was `AgentTab`; host passes `workspaceTabOf(tab)` |
| ~~`counts`~~ | — | removed (counts move to the hub cards) |

Emits `select: [tab: 'chat' \| 'settings']`. No overflow menu.

### `AgentWorkspaceCanvas` — `…/workspace/Canvas.vue`

Props unchanged (`tab: AgentTab` still). New branches: `tab === 'settings'` → hub;
`sectionOf(tab)` → frame + existing section component. Emits gain `setTab: [AgentTab]`
(the hub's `open` and the frame's `back` bubble up as `setTab`).

### `AgentWorkspaceMain` — `…/workspace/Main.vue`

Props/emits unchanged (`id`; `deleted`). Internals: header per plan § Layout; menu items
Restart / Tools / Edit / `<ShareMenuSub>` / — / Delete agent. Uses `UsageLine` (Details → `setTab('overview')`) instead of
`UsagePanel variant="strip"`.

### `AgentChatTab` — `agent/agent/components/agent/chat/Tab.vue`

Props unchanged. Template: single column; `<BridleProvider frameless …>` then
`<AgentLogsBar v-if="active" …>`. `showSideLogs` and the side column are removed.

### `ShareMenuSub` — `share/components/share/menu/Sub.vue` (**new**)

| Prop | Type | Notes |
|------|------|-------|
| `agentId` | `string` | |

No emits. Rendered **inside** `Main.vue`'s `DropdownMenuContent` as a `DropdownMenuSub`:
the `DropdownMenuSubTrigger` row "Share" and a `DropdownMenuSubContent` whose rows are
`DropdownMenuItem`s (see research R6 for the row table per state). Every row except
"Open in the app" calls `preventDefault()` on `select` so the menu stays open. Reads the
link on `@update:open` (true) via `useShareLink`.

### `useShareLink(agentId)` — `share/composables/useShareLink.ts` (**new**)

Lifted from admin's panel Provider unchanged: `link`, `isShared`, `appUrlMissing`,
`shareUrl`, `loadingLink`, `linkUnknown`, `sharedSince`, `copied`, `confirming`,
`revoked`, `pending` (store), `error` (store), `loadLink()`, `onCopy()`, `onShare()`,
`onConfirm()`, `cancelConfirm()`, `reset()` (what the panel's `watch(open)` did).

### `SharePanelProvider` (admin) — `share/components/share/panel/Provider.vue` (**deleted**)

Only host on origin/main was `Main.vue` (`graft grep`). Its logic moves to `useShareLink`,
its presentation to `ShareMenuSub`.

**Twin**: `app/slices/share/components/share/panel/Provider.vue` is untouched — the app
page keeps its Share button and floating panel with the link field; it has no `…` menu.
Stated in the PR.

### `BridleProvider` (admin) — `bridle/components/bridle/Provider.vue`

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `frameless` | `boolean` | `false` | **new**; drops Card chrome and header; status + New chat move to the composer's toggle row; transcript and composer capped at `max-w-4xl` |

All other props unchanged. **Twin**: `app/slices/bridle/components/bridle/chat/Provider.vue`
already has `showHeader` and is rendered headerless by the app page. Nothing to change.

### `UsagePanel` — `usage/components/usage/Panel.vue`

`variant: 'strip'` removed together with its template branch, after `graft callers`
confirms `Main.vue` was the only host. `panel` variant unchanged.

### `sections.ts` — `…/workspace/sections.ts`

Exports: `WORKSPACE_TABS`, `SECTIONS`, `ISection`, `SectionValue`, `AgentTab`,
`DEFAULT_TAB`, `toAgentTab`, `workspaceTabOf`, `sectionOf`. Removed: `AGENT_TABS`,
`PRIMARY_TABS`, `OVERFLOW_TABS`, `IAgentTab`. Consumers on origin/main (`graft grep`): only
`Tabs.vue`; `useAgentTab.ts` imports `DEFAULT_TAB`, `toAgentTab`, `AgentTab`, all of which stay.

### `useAgentRailEntries.ts`

`TONE` map exported (was module-private). No behaviour change.

### `utils/agentLogs.ts`

`+ export interface ILogSummary`, `+ export function summarizeAgentLogs(groups)`.

### `usage/utils/usageLine.ts` (new file)

`export function usageLineText(totals: { costUsd: number }, topModel: string | null): string`.
