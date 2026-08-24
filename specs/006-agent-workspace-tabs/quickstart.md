# Quickstart — Validating the agent workspace

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-20

**Read this first**: neither console has a test runner. `admin/package.json` and
`app/package.json` both declare `"test": "echo '… no tests yet'"` and a stub `lint`. So this
walkthrough *is* the test suite for this feature — it is not a nice-to-have supplement to one.
Every step names the requirement it covers so a reviewer can see what is and is not verified.

## Prerequisites

```bash
ranch dev                 # api + app + admin + local k3d   (or: make dev)
```

| URL | Console |
|-----|---------|
| `http://localhost:3001` | app (customer console) |
| `http://localhost:3002` | admin |
| `http://localhost:3000/api` | Swagger, if you need to check a payload |

Seed data needed: **at least three agents**, one of them flagged `isAdmin` (the Ranch admin
agent), one `stopped` or `failed`, and one with knowledge bases, files, secrets and channels
attached so the counts have something to show.

## Automated gates — run these first

```bash
bun run typecheck      # turbo, filters app + admin; must be clean
bun run i18n:check     # no missing or stale keys in app locales
```

Both must pass before the manual walkthrough is worth doing. `typecheck` runs `openapi-ts`
first, so a stale generated client surfaces here rather than as a mystery type error.

---

## Admin walkthrough

### 1. Landing goes straight to the Ranch admin agent — FR-007, SC-001

Open `http://localhost:3002/agents`.

- The address settles on `/agents/<ranch-admin-id>` — the resolver redirected.
- You are in a conversation. **No table appeared, not even for a frame.**
- Press Back: you leave the agents area entirely; you do **not** bounce through `/agents`
  (that is `replace: true` doing its job).

### 2. Tabs on top, controls in the header — FR-013, FR-017

- The workspace opens on **Chat**. The tab bar under the agent header reads
  `Chat · Overview · Knowledge N · Files N · Channels N · Logs · More ▾`.
- `Stop`/`Start`, `Restart` and `Edit` are buttons in the header; `Delete` is under the `⋯`
  menu behind a confirm. Confirm each does what it did from the old page header / table row.
- Open `More` and pick `Environment`: the control relabels itself `Environment` and marks
  itself active, so you can still tell where you are.

### 3. The rail carries status and date, and nothing else — FR-002

Each row shows: initials avatar, name, live status, creation date, and the Ranch-admin marker
on the admin agent. There is **no** restart button, no `⋯` menu, no delete on a row.

Stop an agent from its panel and watch its rail row: the status changes without a reload
(FR-005 — this is the SSE stream, not a poll).

### 4. Switching agents is one click and does not remount the rail — FR-003, FR-026, SC-002

Open DevTools → Network, then click a different agent in the rail.

- Chat, header, usage strip and panel all switch. Address bar follows (FR-004).
- **The agent-list request does not repeat.** If it does, the `:key` is on the wrong component
  — see [research.md](./research.md) R4.
- Nothing from the previous agent survives: no stale messages, no stale logs, no stale file
  tree. Switch back and forth quickly a few times to be sure.
- Back/Forward move between the agents you visited.

### 5. Chat and logs are exactly as they were — FR-010, SC-003

At a 1440px window with the panel open: chat and logs sit side by side, **both fully
visible with every border drawn**. Nothing is clipped and the page does not scroll
sideways — that failure is exactly what this step is here to catch. Collapse the logs with
their existing button; the space returns to the chat.

At ≥1400px with the panel collapsed the chat is at its usual size and is **not** stretched.
Narrow the window below 1400px and the pair shrinks together rather than overflowing — see
[research.md](./research.md) R1.

Then collapse the admin sidebar to icons: the workspace should re-fit its height, not leave
a gap or overflow. It measures the space rather than assuming a fixed chrome height, so a
change to the layout's padding does not break it either.

### 6. Tabs switch the middle, chat survives — FR-012, FR-014, FR-018, SC-004a

Click **Files** in the tab bar.

- The file tree and the editor render at the full width of the middle column, as on `main`.
- Click **Logs**: the pod logs fill the width. Now open DevTools → Network and confirm the
  Chat tab's **side** log panel has stopped polling — only one log stream should be live.
- Click **Chat**: the conversation returns with **the same transcript, the same scroll
  position, and no reconnect**. No new websocket, no transcript refetch. If any of that
  happens, the chat is being `v-if`'d instead of `v-show`'d (plan Risk 1a).
- On the Chat tab the logs are still beside the conversation with their collapse button.
- Switch to another agent while a tab is open: the same tab opens for that agent.

### 7. Tab counts — FR-015, US3

On an agent with attachments:

- Knowledge, Files and Channels carry numbers in the tab bar that match what each tab lists
  when opened; Secrets carries its number inside the `More` menu.
- An agent with **zero** of something shows `0` — not a blank. A count that has not loaded or
  failed shows **nothing at all**, and the tab still opens normally.

### 8. All eight sections still work — FR-012, SC-004

Open each of Overview, Knowledge, Files, Secrets, Environment, Channels, Chats, Paddock and
perform one real operation in each (edit a file, reveal a secret, add an env var, open a
chat…). Compare each against `main`: **nothing about their layout should have changed** — if
a section needed restyling to fit, the navigator model was not implemented as designed (R2).

### 9. Deep links still land — FR-016, SC-005

| Try | Expect |
|-----|--------|
| `/agents/<id>?tab=env` | Environment tab open, `More` marks itself current |
| `/agents/<id>?tab=paddock` | Paddock tab open |
| `/agents/<id>?tab=logs` | Full-width logs |
| `/agents/<id>?tab=chat` | Conversation, and `tab` stripped from the URL — it is the default |
| `/agents/<id>?tab=nonsense` | Same as `chat` |
| Clicking `Chat` from any of these | `tab` disappears from the URL |
| Usage strip → `Details` | Overview tab |

Tab switching uses `replace`, so Back should leave the agent rather than walking the tabs you
opened.

### 10. Nothing was lost with the table — FR-009, plan Risk 2

Check off each capability the deleted `list/Provider.vue` had. The list below is the result
of the T002 inventory — every line was read out of that file, not guessed:

- [ ] Create an agent → foot of the agent rail
- [ ] `N slots free` → foot of the agent rail, above the create button
- [ ] Cluster-full warning, both variants (no agent nodes / cluster full) → same line, amber
- [ ] Capacity refreshed every 30s → foot of the agent rail
- [ ] Edit → agent header
- [ ] Start / Stop, with the `RESOURCE_HOLDING` rule deciding which → agent header
- [ ] Restart → agent header
- [ ] Delete, with its `ConfirmDialog` naming the agent → agent header `⋯` menu
- [ ] Ranch-admin marker, with its "ranch_* admin tools" tooltip → rail row
- [ ] Status badge using `AGENT_STATUS_VARIANT` → rail row
- [ ] Created date via `formatDateTime` → rail row
- [ ] Resources (cpu / memory) → **dropped** with the settings panel; the Overview tab still shows them
- [ ] Clicking a row opens that agent → rail row
- [ ] "Agents" heading and "Manage running agents." lede → dropped deliberately; the sidebar
      already says where you are, and the workspace opens on a named agent
- [ ] "No agents yet." empty state → workspace empty state
- [ ] Loading skeleton → rail skeleton rows (FR-027)

If anything else turns up in that file, it needs a home before the file is deleted.

### 11. The sidebar is untouched — FR-011, SC-006

Compare the primary sidebar against `main`: every entry present, same order, same icons,
`Agents` still active on the workspace, `Rancher` still going to `/rancher` (the setup page,
not the agent).

### 12. Agent states still overlay correctly — FR-025

On a `stopped` and a `failed` agent: the overlay covers **only** the message area. Rail,
header, usage strip and panel stay usable. Trigger a restart and confirm the pending-restart
banner still appears above the conversation and is not hidden by the panel.

---

## App walkthrough

### 13. Rail replaces the cards, no settings anywhere — FR-019, US2

Open `http://localhost:3001/agents` as a user who can see several agents.

- Redirects into a conversation; no grid of cards.
- The rail lists the visible agents with status and last activity.
- **No settings panel, no settings sections** anywhere on the screen.
- The conversation keeps its readable width — it does not stretch to fill the window.

### 14. The last agent is remembered — FR-020, SC-011

- Switch to agent B, navigate away, come back to `/agents` → you land on B.
- Reload the browser → still B.
- Delete B in admin (or make it invisible to this user), return to `/agents` → you land on the
  first running agent, **not** on a dead id.

### 15. Roles behave as they did — FR-021

As a plain user (not Owner/Admin): no create action in the top row, no `N slots free` badge,
no 403s in the console. Restart follows whatever rule it follows today.

### 16. Russian — FR-022, SC-009

Switch the locale to RU. Every string in the rail, the top row and the empty states is
translated. No raw keys like `rail.search` render anywhere. `bun run i18n:check` stays clean.

---

## Responsive — both consoles

### 17. Long lists and small screens — FR-023, FR-024, SC-008, SC-010

- Type a fragment of a name in the rail: it filters. Clear it: full list returns. A search
  matching nothing shows the "nothing matches" line, not an empty column.
- Narrow to <1024px: rail and (admin) panel become on-demand overlays, conversation stays
  usable.
- At 390px: no horizontal page scroll, message input reachable without dismissing an overlay.

### 18. Empty and loading states — FR-027, edge cases

- With the list still loading, the rail shows skeleton rows, not an empty column.
- With **no** agents at all: the empty state renders in place at `/agents` — create CTA for
  Owner/Admin, the "ask an admin" line otherwise. No redirect loop.
- A single visible agent still renders the rail (FR-006).

---

## Sign-off

The feature is done when steps 1–18 pass, `bun run typecheck` and `bun run i18n:check` are
clean, and the step 10 checklist is fully ticked. Anything that fails goes back to
[tasks.md](./tasks.md) rather than being waived — with no automated suite behind it, this
walkthrough is the only thing standing between a regression and `main`.
