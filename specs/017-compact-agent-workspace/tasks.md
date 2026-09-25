# Tasks: Compact agent workspace — Chat / Settings, one-line usage, logs bar

**Input**: Design documents from `/specs/017-compact-agent-workspace/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tracker**: [CLEAN-123](https://dreamvention.atlassian.net/browse/CLEAN-123) · branch `feat/CLEAN-123-compact-agent-workspace`

**Tests**: the plan (research R9) asks for three pure-util tests run by `bun test slices` in
`admin`. They are listed before the code they cover; write each so it fails first. There is
no component-test harness — interaction rules are verified through quickstart.md.

**Organization**: tasks are grouped by user story. Everything is in `admin/`; `app/` and
`api/` are not touched. All paths below are repository-relative.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 conversation gets the room · US2 Settings hub · US3 usage line · US4 `…` menu + Share submenu

## Path conventions

- Workspace: `admin/slices/agent/agent/components/agent/workspace/`
- Chat / logs / status: `admin/slices/agent/agent/components/agent/{chat,logs,status}/`
- Composables / utils: `admin/slices/agent/agent/{composables,utils}/`
- Usage slice: `admin/slices/usage/`
- Share slice: `admin/slices/share/`
- Bridle (chat widget): `admin/slices/bridle/components/bridle/Provider.vue`
- Vendored UI primitives: `admin/slices/setup/theme/components/ui/` (import via `#theme/components/ui/...`)
- Components auto-import by path: `components/agent/logs/Bar.vue` → `<AgentLogsBar>`, `components/usage/Line.vue` → `<UsageLine>`, `components/share/menu/Sub.vue` → `<ShareMenuSub>`

---

## Phase 1: Setup

**Purpose**: a known-green baseline before anything moves.

- [X] T001 Run the baseline gates in `admin/`: `bun test slices` (nine util tests green) and `bun run typecheck` (clean), then `git checkout --` the SDK files `openapi-ts` regenerated; record both results in the CLEAN-123 start-of-implementation comment.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the tab model every story reads. US1 needs the two-tab header, US2 needs the section catalogue and the `settings` value, US3/US4 render in the same header row.

**⚠️ CRITICAL**: no user-story work starts before T004 is green.

- [X] T002 Write `admin/slices/agent/agent/utils/sections.test.ts` (bun test) asserting the table in `contracts/url-tab-contract.md`: `toAgentTab` returns `'settings'` for `'settings'`, `'a2a'` for `'peers'`, `'chat'` for `undefined` / `'bogus'` / `['files']`→`'files'` (array takes first); `workspaceTabOf` is `'chat'` only for `'chat'`; `sectionOf` is `null` for `'chat'` and `'settings'` and the matching record for all ten section values; `SECTIONS` has exactly ten entries in hub order. It fails to compile/import until T003.
- [X] T003 Rewrite `admin/slices/agent/agent/components/agent/workspace/sections.ts` per research R1 / contracts: export `WORKSPACE_TABS = ['chat','settings'] as const`, `ISection { value, title, desc, countKey, icon }`, `SECTIONS` (the ten sections in order Overview, Knowledge, A2A, Files, Channels, Logs, Secrets, Environment, Chats, Paddock, reusing today's `desc` strings and adding a `@tabler/icons-vue` icon each), `SectionValue`, `AgentTab = 'chat' | 'settings' | SectionValue`, `DEFAULT_TAB`, `LEGACY_TAB_ALIASES`, `toAgentTab` (now accepting `'settings'`), `workspaceTabOf`, `sectionOf`. Remove `AGENT_TABS`, `PRIMARY_TABS`, `OVERFLOW_TABS`, `IAgentTab`. Keep `SectionCountKey` / `SectionCounts` unchanged (`useAgentSectionCounts` imports them).
- [X] T004 Rewrite `admin/slices/agent/agent/components/agent/workspace/Tabs.vue` to the two-tab bar from `contracts/components.md`: props `active: 'chat' | 'settings'`, emit `select`, `role="tablist"` / `role="tab"` / `aria-selected` kept, no counts, no `DropdownMenu` overflow, iterate `WORKSPACE_TABS` with titles "Chat" / "Settings". Run `bun test slices` → T002 green; `bun run typecheck` will still flag `Main.vue` (fixed in T011) — note it, do not chase it here.

**Checkpoint**: tab model in place; `?tab=settings` normalises correctly; header bar compiles with two tabs.

---

## Phase 3: User Story 1 — The conversation gets the room (Priority: P1) 🎯 MVP

**Goal**: identity row with a status dot, Chat / Settings tabs, a borderless full-width chat, and a collapsed Logs bar under the composer that expands in place with exactly one log poller alive at any time.

**Independent Test**: open a running agent — header has the two tabs; no status badge / "restarted N ago" text (both in the dot's tooltip); chat has no card border and spans the column; Logs bar shows the newest line and a count, expands to the existing panel, and the network tab shows one `/logs` request per 5 s before and after expanding, none while Settings is open. (The usage line and the `…` menu land in US3/US4; until then the old strip and buttons stay.)

### Tests for User Story 1

- [X] T005 [P] [US1] Write `admin/slices/agent/agent/utils/agentLogs.test.ts` (bun test) for `summarizeAgentLogs(groups)`: `[]` → `{ latest: null, total: 0, alerts: 0 }`; two groups of 2 + 3 lines → `total 5`, `latest` is the last line of the last group; lines with `level: 'warn'` and `'error'` are both counted in `alerts`, `level: null` is not. Build inputs by calling the existing `parseAgentLogs` on a small raw string with K8s timestamps so the test also pins the level heuristics it relies on.

### Implementation for User Story 1

- [X] T006 [P] [US1] Add `export interface ILogSummary { latest: IAgentLogLine | null; total: number; alerts: number }` and `export function summarizeAgentLogs(groups: IAgentLogGroup[]): ILogSummary` to `admin/slices/agent/agent/utils/agentLogs.ts` (index loops, not `for…of` with `!` — see memory on the Bun JIT crash). T005 green.
- [X] T007 [P] [US1] Export the `TONE` map (and its `IRailStatusTone` type) from `admin/slices/agent/agent/composables/useAgentRailEntries.ts`; no behaviour change.
- [X] T008 [P] [US1] Create `admin/slices/agent/agent/components/agent/status/Dot.vue` (`<AgentStatusDot>`) per `contracts/components.md`: props `status`, `statusReason`, `deployVerb`, `deployAgo`, `deployHintTitle`; renders a `size-2.5` dot (pulse ring when `TONE[status].pulse`) inside the vendored `TooltipProvider/Tooltip/TooltipTrigger/TooltipContent` from `#theme/components/ui/tooltip`; tooltip lines: `<status> · <deployVerb> <deployAgo>` (verb/ago omitted when null), `statusReason` when present, `deployHintTitle` when present. Root gets `class` passthrough so the host can position it.
- [X] T009 [P] [US1] Add the `frameless` prop to `admin/slices/bridle/components/bridle/Provider.vue` per research R4: default `false`; when true the root `Card` adds `border-0 shadow-none bg-transparent` (still a `Card`, so `data-slot="card-content"` survives for the Chat Tab overlay measurement), the `CardHeader` is not rendered (`v-if="!frameless"`), the transcript wrapper and the `CardFooter` get `mx-auto w-full max-w-4xl`, and the composer's toggle row (`Debug`, `Markdown`) additionally renders on the right the **New chat** ghost button (same `confirmResetOpen` / disabled logic as the header's) and the connection status dot + label (`showStatus && connectionStatus`). Header markup for the non-frameless path is untouched; `ConfirmDialog` for reset stays mounted in both modes.
- [X] T010 [US1] Create `admin/slices/agent/agent/components/agent/logs/Bar.vue` (`<AgentLogsBar>`) per research R5 and `contracts/components.md`: props `agentId`, `restarting`, `firstStart`; internal `expanded = ref(false)`. **Collapsed branch** (`v-if="!expanded"`): calls `useAgentLogs(agentId)`, computes `summarizeAgentLogs(logGroups.value)`, renders one full-width `<button>` row: `IconChevronRight` + "Logs" on the left, then the state text in precedence order `restarting` ("Agent is restarting…" / "Setting up agent…" by `firstStart`) → `containerWaitingLabel` (with `IconLoader2` spinner) → `statusLabel` → `error` ("Logs unavailable") → `latest === null` ("No entries yet") → `latest.time` (tabular, muted) + `latest.text` (mono, truncated, level colour when set); right side `<total> entries` and, when `alerts > 0`, `· <alerts> ⚠` in amber. **Expanded branch** (`v-else`): a `basis-2/5 min-h-56 max-h-[45%]` region rendering `<AgentLogsPanel :agent-id closable :restarting :first-start class="h-full" @close="expanded = false" />`. Clicking the bar toggles `expanded`. Exactly one of the two branches exists at a time (SC-005 by construction).
- [X] T011 [US1] Rework `admin/slices/agent/agent/components/agent/chat/Tab.vue`: single column (`flex h-full min-h-0 flex-col`), `<BridleProvider frameless … class="min-h-0 flex-1 w-full">` unchanged props otherwise, then `<AgentLogsBar v-if="active" :agent-id="agent.id" :restarting="restartUnderway" :first-start="agent.launchContext === 'initial'" class="shrink-0" />`. Remove `showSideLogs`, the side `AgentLogsPanel`, the `Logs` show button, `IconFileText`, and the `basis-1/2 max-w-200 min-[1400px]:min-w-100` wrapper; keep `chatWrapRef` + overlay measurement and the failure overlay as they are. Delete the now-obsolete width comment block and write one that says why the bar is `v-if="active"`.
- [X] T012 [US1] Update `admin/slices/agent/agent/components/agent/workspace/Main.vue` for US1: (a) `<AgentWorkspaceTabs :active="workspaceTabOf(tab)" @select="setTab" />` — importing `workspaceTabOf` from `./sections` — and drop the `:counts` prop from the tab bar (counts stay fetched for US2); (b) wrap the initials avatar in a `relative` box and render `<AgentStatusDot class="absolute -bottom-0.5 -right-0.5" :status="displayStatus" :status-reason="statusReason" :deploy-verb="lastDeployStartedAt ? deployVerb : null" :deploy-ago="lastDeployStartedAt ? deployAgo : null" :deploy-hint-title="deployHintTitle" />`; (c) remove the `Badge`, the "restarted N ago" `<span>` with its `Transition`, the `time-tick` styles and the now-unused imports; keep `runtimeOffline` text, `IconShield`, the pending-restart banner, and — for now — the usage strip and the action buttons (US3/US4 replace them). Typecheck must be clean after this task.
- [ ] T013 [US1] Walk US1 steps 1–6 of `specs/017-compact-agent-workspace/quickstart.md`, post the US1 checkpoint comment on CLEAN-123 (what landed: tab model, dot, frameless chat, logs bar; next: Settings hub) and commit `feat(admin): chat takes the column, logs bar under the composer (CLEAN-123)`.

**Checkpoint**: US1 walk in quickstart.md steps 1–6 passes (except the usage line and `…` items, which are US3/US4).

---

## Phase 4: User Story 2 — Settings is a hub of cards (Priority: P2)

**Goal**: Settings opens a grid of ten section cards with counts; a card opens its section at full width under a "← Settings" frame; every old `?tab=` link lands on its section; the chat survives the round trip.

**Independent Test**: click Settings → ten cards with descriptions and the five counts (muted "…" while unknown, never `0` for unknown); click Files → `?tab=files`, frame row, Files section, Settings tab highlighted; "← Settings" → hub; paste each pre-existing `?tab=` value → right section; switch agents from the hub → new agent opens on Chat.

### Implementation for User Story 2

- [X] T014 [P] [US2] Create `admin/slices/agent/agent/components/agent/workspace/SectionCard.vue` (`<AgentWorkspaceSectionCard>`): props `section: ISection`, `count: number | null`; emit `select`; a `<button type="button">` styled like the reference card (rounded border, hover ring, left-aligned): icon tile (`size-9 rounded-lg bg-linear-to-br from-primary/20 to-primary/5 text-primary` with `section.icon`), `section.title` (font-medium), `section.desc` (text-xs muted, 2-line clamp), and when `section.countKey` is set a chip that reads the number or a muted "…" when `count === null` (`0` renders as `0`).
- [X] T015 [P] [US2] Create `admin/slices/agent/agent/components/agent/workspace/SettingsHub.vue` (`<AgentWorkspaceSettingsHub>`): props `sections: readonly ISection[]`, `counts: SectionCounts`; emit `open: [SectionValue]`; `grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3` of `SectionCard`, `count` derived from `counts[section.countKey]` (null when no key).
- [X] T016 [P] [US2] Create `admin/slices/agent/agent/components/agent/workspace/SectionFrame.vue` (`<AgentWorkspaceSectionFrame>`): prop `section: ISection`; emit `back`; one `shrink-0` row with a ghost `Button` (`IconArrowLeft` + "Settings") and the section title (`text-sm font-medium`), then a default `<slot />` in a `min-h-0 flex-1 overflow-y-auto` box.
- [X] T017 [US2] Update `admin/slices/agent/agent/components/agent/workspace/Canvas.vue`: add props `counts: SectionCounts`; add emit `setTab: [AgentTab]`; `chatActive = tab === 'chat'` stays; new `v-else-if="tab === 'settings'"` branch renders `<AgentWorkspaceSettingsHub :sections="SECTIONS" :counts @open="(v) => emit('setTab', v)" />`; the existing section `v-if` chain moves inside `<AgentWorkspaceSectionFrame v-else :section="sectionOf(tab)!" @back="emit('setTab', 'settings')">…</AgentWorkspaceSectionFrame>` with the per-section components unchanged (Overview, Knowledge, A2A, Files card, Channels, Logs panel, Secrets card, Env, Chats, Paddock). Keep the `v-show` rule comment for the chat.
- [X] T018 [US2] Update `admin/slices/agent/agent/components/agent/workspace/Main.vue` for US2: pass `:counts="counts"` to `<AgentWorkspaceCanvas>` and handle `@set-tab="setTab"`; keep the `watch(tab, t => t === 'overview' && refresh())`. Confirm `useAgentTab` needs no change (T003 made `toAgentTab` accept `settings`; `setTab('chat')` still strips the param).
- [ ] T019 [US2] Walk quickstart.md US2 steps 1–5 (all twelve `?tab=` inputs from `contracts/url-tab-contract.md`, hub ↔ section ↔ chat round trip with transcript intact, agent switch lands on Chat); post the US2 checkpoint comment on CLEAN-123 and commit `feat(admin): settings hub of section cards (CLEAN-123)`.

**Checkpoint**: US1 + US2 work together; the old tab bar and More menu are gone from the screen.

---

## Phase 5: User Story 3 — One usage line that opens on demand (Priority: P2)

**Goal**: the six-figure strip becomes `$15.31 / 30d · claude-haiku-4-5`; clicking it opens a small popover with the figures and a Details action; loading / error / empty states are muted text.

**Independent Test**: on an agent with usage the header shows the one line; click → popover with Cost / Calls / Input / Output / Today (today's model on hover) + Details → Overview section; no-usage agent → "No usage yet" (not clickable); API down → "Usage unavailable"; narrow window → model truncates before cost.

### Tests for User Story 3

- [X] T020 [P] [US3] Write `admin/slices/usage/utils/usageLine.test.ts` (bun test) for `usageLineText`: `({ costUsd: 15.31 }, 'claude-haiku-4-5')` → `"$15.31 / 30d · claude-haiku-4-5"`; `({ costUsd: 15.31 }, null)` → `"$15.31 / 30d"` (no trailing separator); `({ costUsd: 0.0042 }, 'x')` keeps `formatUsd`'s precision rules.

### Implementation for User Story 3

- [X] T021 [P] [US3] Create `admin/slices/usage/utils/usageLine.ts` exporting `usageLineText(totals: { costUsd: number }, topModel: string | null): string` built on `formatUsd` from `#agent/utils/agentFormat`. T020 green.
- [X] T022 [US3] Create `admin/slices/usage/components/usage/Line.vue` (`<UsageLine>`) per research R3: prop `agentId`; emit `details`; `useAsyncData(\`usage-panel-agent-${agentId}\`, () => usageStore.fetchForAgent(agentId), { lazy: true })` (same key the strip used so the request is shared); state → `loading` "Loading usage…" / `error` "Usage unavailable" (text-destructive) / `empty` (`callCount === 0`) "No usage yet" as plain muted `<span>`s; `ready` → reka-ui `PopoverRoot/PopoverTrigger/PopoverPortal/PopoverContent` (imported from `reka-ui` like the share panel did) whose trigger is a text button `text-sm text-muted-foreground hover:text-foreground` with the cost in `font-medium` and the ` · <model>` part in a `truncate` span (`min-w-0`); content `w-64` lists Cost / Calls / Input / Output (`formatUsd`, `count`, `formatCount`) and Today `<n> calls` with `title` = `Today · in … / out … · <model>` (same as the strip's `todayTitle`), then a `Button size="sm" variant="outline"` "Details" that closes the popover and emits `details`.
- [X] T023 [US3] Update `admin/slices/agent/agent/components/agent/workspace/Main.vue` for US3: replace `<UsagePanel … variant="strip" @details="setTab('overview')" />` (and its comment) with `<UsageLine :agent-id="agent.id" class="min-w-0" @details="setTab('overview')" />` placed **in the header row** after the tabs and a `flex-1` spacer, before the actions; give the header row `flex-wrap` and the line `order-last basis-full md:order-none md:basis-auto` so below ~900 px it wraps under the tabs while Stop / `…` stay on the row (research R8). Remove the standalone usage strip row.
- [X] T024 [US3] Remove the `strip` variant from `admin/slices/usage/components/usage/Panel.vue`: the `variant` prop type becomes `'panel'` only (or drop the prop and the `v-if="variant === 'strip'"` block, the `details` emit and `todayTitle` if they were strip-only — check `graft callers` for `UsagePanel` hosts: Overview usage card and Rancher use `panel`). Typecheck clean.
- [ ] T025 [US3] Walk US3 steps 1–4 of `specs/017-compact-agent-workspace/quickstart.md`; post the US3 checkpoint comment on CLEAN-123 and commit `feat(admin): one-line usage with a details popover (CLEAN-123)`.

**Checkpoint**: header is identity · tabs · usage line · [old action buttons]; strip row gone.

---

## Phase 6: User Story 4 — Actions fold into `…`, Share is a submenu (Priority: P3)

**Goal**: only Stop/Start stays visible; `…` holds Restart, Tools, Edit, Share ▸, Delete agent; Share opens as a submenu beside its row with every control as a menu row, and the menu stays open through Copy / Regenerate / Revoke.

**Independent Test**: open `…` → five items in order; hover Share → submenu beside the row, menu still open; Copy link → "Copied", menu open; Revoke → question rows → Cancel restores; ← closes only the submenu, Escape closes the menu; Tools / Delete close the menu then open their sheet / dialog; Restart disabled while restarting.

### Implementation for User Story 4

- [X] T026 [P] [US4] Create `admin/slices/share/composables/useShareLink.ts` by lifting the `<script setup>` logic of `admin/slices/share/components/share/panel/Provider.vue` verbatim into `export function useShareLink(agentId: MaybeRefOrGetter<string>)`: returns `link`, `isShared`, `appUrlMissing`, `shareUrl`, `loadingLink`, `linkUnknown`, `sharedSince`, `copied`, `confirming`, `revoked`, `pending` (store), `error` (store), `loadLink()`, `onCopy()`, `onShare()`, `onConfirm()`, `cancelConfirm()`, and `reset()` (what the panel's `watch(open)` did on open: clear `confirming`, `revoked`, `copied`, then `loadLink`). `onBeforeUnmount(resetCopied)` stays inside the composable.
- [X] T027 [US4] Create `admin/slices/share/components/share/menu/Sub.vue` (`<ShareMenuSub>`) per research R6's row table: prop `agentId`; uses `useShareLink`; template is `DropdownMenuSub` (`@update:open="(o) => o && reset()"`) → `DropdownMenuSubTrigger` (`IconShare2` + "Share") → `DropdownMenuSubContent class="w-72"` with rows by state: loading → disabled item with `IconLoader2`; `linkUnknown` → disabled item "Could not load the share link." + item **Try again** (`@select.prevent="loadLink"`); shared → `DropdownMenuLabel` holding the URL in `font-mono text-xs truncate` with `:title="shareUrl"` and "Shared <date>" beneath (or the amber `NUXT_PUBLIC_APP_URL` note when `appUrlMissing`), item **Copy link** / **Copied** (`@select.prevent="onCopy"`, hidden when `appUrlMissing`), item **Open in the app** (`as-child` → `<a :href target="_blank" rel="noopener">`, hidden when `appUrlMissing`; this one may close the menu), `DropdownMenuSeparator`, item **Regenerate** (`@select.prevent="confirming = 'regenerate'"`), item **Revoke** (`variant="destructive"`, `@select.prevent="confirming = 'revoke'"`); confirming → disabled item with the question text, item **Revoke link** / **Replace link** (destructive, `IconLoader2` while `pending`, `@select.prevent="onConfirm"`), item **Cancel** (`@select.prevent="cancelConfirm"`); not shared → disabled item "This agent is not shared." / "Link revoked." + item **Share** (`@select.prevent="onShare"`); store `error` (when not `linkUnknown`) → trailing disabled item "Could not update the share link." All rows `:disabled="pending"` where the panel disabled them. `.prevent` on `@select` is what keeps the menu open (reka-ui honours `defaultPrevented`).
- [X] T028 [US4] Rework the header actions in `admin/slices/agent/agent/components/agent/workspace/Main.vue`: keep the Stop/Start `Button` as is; remove the Restart, `ToolCatalogButton`, `SharePanelProvider` and Edit buttons; the `DropdownMenuContent` now holds, in order: **Restart** (`IconRefresh`, `:disabled="isRestarting || toggling"`, `@select="restart"`), **Tools** (`Wrench` from `lucide-vue-next` or `IconTool`, `@select="toolCatalogStore.openSheet(agent.id)"`), **Edit** (`as-child` → `<NuxtLink :to="\`/agents/${agent.id}/edit\`">`), `<ShareMenuSub :agent-id="agent.id" />`, `DropdownMenuSeparator`, **Delete agent** (unchanged). Import `useToolCatalogStore` from `#agent/../toolCatalog/stores/toolCatalog` (match the import path `ToolCatalogButton` uses) and `DropdownMenuSeparator` from the vendored set. Update the header comment ("Delete lives in the overflow menu…") to describe the new menu.
- [X] T029 [US4] Delete `admin/slices/share/components/share/panel/Provider.vue` (only host was `Main.vue`, replaced in T028) and update the header comment of `admin/slices/share/composables/useShareLink.ts` to carry the CLEAN-104 provenance note the panel had. Run `graft grep "SharePanelProvider" --in admin/` → no hits; typecheck clean.
- [ ] T030 [US4] Walk US4 steps 1–11 and the keyboard walk of `specs/017-compact-agent-workspace/quickstart.md`; if a row ever closes the menu unexpectedly, check the `@select.prevent` modifier on that row first. Post the US4 checkpoint comment on CLEAN-123 and commit `feat(admin): header actions under the menu, share as a submenu (CLEAN-123)`.

**Checkpoint**: all four stories complete; the header row is exactly identity · Chat/Settings · usage line · Stop · `…`.

---

## Phase 7: Polish & cross-cutting

- [ ] T031 [P] Responsive pass on `admin/slices/agent/agent/components/agent/workspace/Main.vue` and `SettingsHub.vue` at 1440 / 1280 / 900 px per research R8 and the spec's narrow-window edge case: name truncates before the tabs, usage line wraps under the tabs below ~900 px, Stop / `…` never leave the row, hub goes 3 → 2 → 1 columns.
- [ ] T032 [P] Reduced-motion and a11y pass across `admin/slices/agent/agent/components/agent/status/Dot.vue` (pulse respects `prefers-reduced-motion` via `motion-safe:animate-ping`), `admin/slices/agent/agent/components/agent/workspace/SectionCard.vue` (visible focus ring), `admin/slices/agent/agent/components/agent/logs/Bar.vue` (`aria-expanded` on the bar button) and `admin/slices/usage/components/usage/Line.vue` (`aria-label="Usage details"` on the trigger).
- [X] T033 Update `admin/slices/agent/agent/components/agent/workspace/Canvas.vue` and `sections.ts` header comments to point at `specs/017-compact-agent-workspace` (they currently narrate specs/006's tab bar), and add a one-paragraph note to `specs/006-agent-workspace-tabs/spec.md` under "Visual reference" saying the tab bar was superseded by 017 (no other doc lists the workspace layout).
- [ ] T034 Final gates in `admin/`: `bun test slices` (twelve tests green), `bun run typecheck` clean, then `git checkout --` the regenerated SDK files; full quickstart.md walk including the twin-console step (open the app console's `/agents/<id>` and confirm nothing changed).
- [ ] T035 Open the GitHub PR into `main` titled `feat(admin): compact agent workspace — Chat / Settings, one-line usage, logs bar (CLEAN-123)` with `curl` against `https://api.github.com/repos/CleanSlice/ranch/pulls` (body from a UTF-8 file, `--data-binary`): summary per story, the Share-submenu decision, the twin-check line ("app checked, nothing needed: no tabs, usage strip, side logs or menu exist there; `share` and `bridle` app twins untouched"), link to the spec, and the Claude attribution footer; put the PR URL on CLEAN-123 and transition the issue to **51 In Testing** (the board has no In Review column).

---

## Dependencies & execution order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)**: T002 → T003 → T004 strictly in order (test, model, tab bar).
- **US1 (Phase 3)** depends on Phase 2. Inside it: T005 → T006; T007 → T008; T009, T010 independent; T011 needs T009 + T010; T012 needs T004 + T008 + T011.
- **US2 (Phase 4)** depends on Phase 2 and on T012 (Main.vue wiring). T014 → T015; T016 independent; T017 needs T015 + T016; T018 needs T017.
- **US3 (Phase 5)** depends on Phase 2 and T012 (header row exists). T020 → T021 → T022 → T023 → T024.
- **US4 (Phase 6)** depends on T012 and T023 (final header row). T026 → T027 → T028 → T029.
- **Polish (Phase 7)** depends on all stories; T031–T033 parallel, then T034 → T035.

### User-story independence

- US1 is the MVP: deliverable and demoable alone (old strip / buttons remain until US3 / US4).
- US2 is independent of US3 / US4; it only needs the two-tab header from US1's T012.
- US3 and US4 both edit `Main.vue`'s header row; run them sequentially (US3 first, it defines the row layout US4's buttons drop into) or by one developer.

### Parallel opportunities

- Phase 3: T005 ‖ T007 ‖ T009 (three files), then T006 ‖ T008 ‖ T010.
- Phase 4: T014 ‖ T016, then T015.
- Phase 5: T020 ‖ (nothing else — T021 depends on it); T024 can run beside T023 if `Main.vue` is edited first.
- Phase 6: T026 alone, then T027; T028 needs T027.
- Phase 7: T031 ‖ T032 ‖ T033.

---

## Parallel example: User Story 1

```bash
# Different files, no shared state — launch together:
Task: "T005 write utils/agentLogs.test.ts for summarizeAgentLogs"
Task: "T007 export TONE from composables/useAgentRailEntries.ts"
Task: "T009 add the frameless prop to bridle/components/bridle/Provider.vue"

# Then, again in parallel:
Task: "T006 implement summarizeAgentLogs in utils/agentLogs.ts"
Task: "T008 create components/agent/status/Dot.vue"
Task: "T010 create components/agent/logs/Bar.vue"
```

---

## Implementation strategy

### MVP first (User Story 1)

1. T001 baseline, T002–T004 tab model.
2. T005–T012 → the chat owns the column, logs bar works, status dot in place.
3. **Stop and validate** with quickstart US1 (one poller, borderless chat, dot tooltip); T013 checkpoint + commit.

### Incremental delivery

1. US2 (hub) → quickstart US2 → T019 checkpoint + commit.
2. US3 (usage line) → quickstart US3 → T025 checkpoint + commit.
3. US4 (`…` menu + Share submenu) → quickstart US4 + keyboard walk → T030 checkpoint + commit.
4. Polish → gates → PR → In Testing.

Each story leaves the screen usable: nothing is removed before its replacement exists
(the strip goes only when the line is in, the buttons only when the menu has them).

---

## Notes

- Never `v-if` the chat; only its `AgentLogsBar` is gated on `active`.
- `null` counts render as "…", `0` as `0` — same rule in the hub as in the old tab bar.
- Every share row that must keep the menu open uses `@select.prevent`; "Open in the app" is the one that may close it.
- `bun run typecheck` regenerates the SDK — revert the generated files after each run.
- Admin is English-only; no `en.json` / `i18n:sync` work.
- Ticket comments at every checkpoint (T013, T019, T025, T030) in teammate tone; PR URL and In Testing at T035.
