# Data Model: Compact agent workspace

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-09-25

Nothing is persisted and no API shape changes. This document lists the view-models the
new components compute and the transient state they hold, so tasks can name them.

## Addressable state

### `AgentTab` (URL value, `?tab=`)

| Value | Meaning | Workspace tab | Section |
|-------|---------|---------------|---------|
| *(absent)* / `chat` | conversation | `chat` | — |
| `settings` | **new** — the Settings hub | `settings` | — |
| `overview` `knowledge` `a2a` `files` `channels` `logs` `secrets` `env` `chats` `paddock` | one section open at full width | `settings` | that section |
| `peers` | legacy alias, normalised to `a2a` on read | `settings` | `a2a` |
| anything else | normalised to `chat` | `chat` | — |

Derivations (pure, in `sections.ts`):

- `toAgentTab(raw: unknown): AgentTab` — existing; now also returns `'settings'`.
- `workspaceTabOf(tab: AgentTab): 'chat' | 'settings'`.
- `sectionOf(tab: AgentTab): ISection | null`.

Rules: `chat` is the default and is stripped from the address (existing behaviour of
`useAgentTab`); switching tabs uses `router.replace`, switching agents uses `push`
(unchanged).

## Static catalogue

### `ISection`

| Field | Type | Notes |
|-------|------|-------|
| `value` | `SectionValue` | one of the ten URL values above |
| `title` | `string` | card title and frame title |
| `desc` | `string` | the one-liner already carried by each tab today |
| `countKey` | `SectionCountKey \| null` | `knowledge`, `a2a`, `files`, `secrets`, `channels`, else `null` |
| `icon` | tabler icon component | **new** — the card's tile |

`SECTIONS: readonly ISection[]` in hub order: Overview, Knowledge, A2A, Files, Channels,
Logs, Secrets, Environment, Chats, Paddock.

### `SectionCounts` — unchanged

`Record<SectionCountKey, number | null>` from `useAgentSectionCounts`. `null` = unknown
or failed → the card shows a muted placeholder; `0` renders as `0`.

## View-models

### `IUsageLine` (computed inside `UsageLine.vue`)

| Field | Type | Source |
|-------|------|--------|
| `state` | `'loading' \| 'error' \| 'empty' \| 'ready'` | `useAsyncData` of `usageStore.fetchForAgent(agentId)` (same key as the strip used) |
| `text` | `string` | `usageLineText(totals, topModel)` → `"$15.31 / 30d · claude-haiku-4-5"` or `"$15.31 / 30d"` |
| `figures` | `{ cost, calls, input, output, todayCalls, todayModel }` | `agentUsage.totals` and `agentUsage.today` |

Only `state === 'ready'` renders a button; the other states render muted text (FR-012).

### `ILogSummary` (pure util `summarizeAgentLogs(groups)`)

| Field | Type | Rule |
|-------|------|------|
| `latest` | `IAgentLogLine \| null` | last line of the last group; `null` when there are no lines |
| `total` | `number` | count of all lines across groups |
| `alerts` | `number` | lines whose `level` is `warn` or `error` |

Bar text precedence (collapsed state): `restarting` prop → `containerWaitingLabel` →
`statusLabel` → `error` → `latest === null` ("No entries yet") → `latest`.

### Status dot input (props of `AgentStatusDot`)

| Prop | Type | Source in `Main.vue` |
|------|------|----------------------|
| `status` | `AgentStatusTypes` | `agent.status ?? 'pending'` |
| `statusReason` | `string \| null` | `agent.statusReason` |
| `deployVerb` | `'started' \| 'restarted' \| null` | from `launchContext`; `null` when no `lastDeployStartedAt` |
| `deployAgo` | `string \| null` | `useTimeAgoIntl` label |
| `deployHintTitle` | `string \| undefined` | existing computed |

Tone (`dot`, `text`, `pulse`) comes from the exported `TONE[status]` map.

## Transient component state

| Owner | State | Type | Reset when |
|-------|-------|------|------------|
| `AgentLogsBar` | `expanded` | `boolean` (default `false`) | agent changes (`Main` is keyed by id) |
| `UsageLine` | `open` (popover) | `boolean` | agent changes; closes on outside click / Escape |
| `ShareMenuSub` (via `useShareLink`) | `copied` | `boolean` + 1.5 s timer | after the timer; on submenu open; before revoke/regenerate |
| `ShareMenuSub` (via `useShareLink`) | `confirming` | `'revoke' \| 'regenerate' \| null` | on submenu open; after the confirmed call; on Cancel |
| `ShareMenuSub` (via `useShareLink`) | `revoked` | `boolean` | on submenu open; set after a successful revoke |
| `BridleProvider` | none new | `frameless` is a prop, not state | — |

## Invariants

1. **One overlay at a time** in the header: the `…` menu is the only floating surface;
   Share is a submenu *of* it, not a second overlay, and its rows keep the menu open by
   preventing the item `select` default.
2. **One log poller at a time**: `AgentLogsBar` mounts either its own `useAgentLogs`
   (collapsed) or `AgentLogsPanel` (expanded), never both; the bar is not mounted while
   the chat is inactive; the full-width Logs section is a different tab, so the chat is
   inactive whenever it is shown.
3. **The conversation survives every tab change**: the chat stays `v-show`n behind the
   hub and any section (existing Canvas rule).
4. **`null` counts never render as `0`** (existing rule, carried to the cards).
