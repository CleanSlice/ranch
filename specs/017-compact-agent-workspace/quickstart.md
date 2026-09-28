# Quickstart: validating the compact agent workspace

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contracts**: [url-tab-contract.md](./contracts/url-tab-contract.md), [components.md](./contracts/components.md)

## Prerequisites

- Branch `feat/CLEAN-123-compact-agent-workspace`, deps installed (`bun install` at root).
- A running `api` (`cd api && bun run dev`) with at least one running agent and one
  stopped agent, and one agent that has usage.
- `admin` dev server: `cd admin && bun run dev` → http://localhost:3001.

## Automated gates

```bash
cd admin
bun test slices            # sections / agentLogs summary / usageLine util tests + the existing nine
bun run typecheck          # regenerates the SDK first; afterwards: git checkout -- <generated files>
```

Expected: all tests green; typecheck clean. (Memory: run jest/bun directly rather than
`bun run test` in `api`; not relevant here — admin only.)

## Manual walk (maps to the spec's user stories)

### US1 — the conversation gets the room

1. Open `/agents/<running-id>`. Header shows: avatar with a green dot, name, admin shield
   (if any), **Chat** / **Settings** tabs, `$x.xx / 30d · <model>`, **Stop**, **⋯**. No
   badge, no "restarted N ago" text, no Restart/Tools/Edit/Share buttons.
2. Hover the dot → tooltip reads `running · restarted 2 minutes ago` (+ reason + deploy
   hint when present).
3. The chat has no card border and spans the column; the transcript and composer are
   centred with a readable width. Under the composer: `▸ Logs · <time> <text>` and
   `<N> entries` on the right.
4. Click the bar → the log panel opens below the composer (~40 % height) with Auto 5 s /
   Reload / ✕. Network tab: exactly one `/agents/<id>/logs` request every 5 s, before and
   after expanding. Click ✕ → collapses.
5. Click **Stop** → chat overlay says stopped; the bar reads "No pod yet — agent is
   stopped." Click **Start** → the bar shows "Setting up agent…" / "Agent is restarting…"
   until lines arrive.
6. Open Settings, wait 15 s, watch the network tab: no log requests while Settings is
   open. Back to Chat: polling resumes, transcript and scroll position intact.

### US2 — Settings: list of cards beside the open section

1. Click **Settings** → URL is `?tab=overview`; ten cards stacked on the left, each with
   icon, title, description; Knowledge / A2A / Files / Channels / Secrets show a count chip
   (or a muted "…" while unknown — never `0` for unknown). Overview is highlighted and its
   content is on the right.
2. Click **Files** → URL `?tab=files`; the content on the right swaps to Files, the Files
   card is highlighted, the list has not moved; Settings stays highlighted in the header.
3. Click **Secrets**, then **Paddock** straight from there → one click each, no way back
   needed. Scroll the list on a short window: it scrolls on its own, the content does not
   move with it.
4. Click **Chat**, then **Settings** → Settings reopens on Paddock, not on Overview.
5. Paste each of `?tab=overview|knowledge|a2a|peers|files|channels|logs|secrets|env|chats|paddock`
   → lands on that section with its card highlighted (`peers` shows A2A). `?tab=settings`
   → Overview. `?tab=chat`, `?tab=bogus`, no param → Chat.
6. From Settings, switch agents in the rail → the new agent opens on Chat, and its
   Settings opens on Overview.
7. Narrow the window below ~1024 px → the cards become one horizontally scrolling row
   above the content.

### US3 — usage line

1. On an agent with usage: the line reads `$x.xx / 30d · <model>`; click → popover with
   Cost, Calls, Input, Output, Today (hover Today → today's model); **Details** → Overview
   section opens (`?tab=overview`), popover closed.
2. On an agent with no usage: line reads "No usage yet", not clickable.
3. Stop the API briefly → "Usage unavailable", not clickable.
4. Narrow the window to ~900 px → the model name truncates first; below that the line
   wraps under the tabs and Stop / ⋯ stay on the header row.

### US4 — `…` menu and Share

1. Open **⋯** → items: Restart, Tools, Edit, Share ▸, ─, Delete agent (red).
2. Hover **Share** (or click it, or press →) → a submenu opens beside the row; the menu
   stays open. On a shared agent: the link row (full URL on hover, "Shared <date>"),
   Copy link, Open in the app, Regenerate, Revoke.
3. Choose **Copy link** → clipboard has the URL, the row reads "Copied" for a moment, the
   menu is still open.
4. Choose **Revoke** → rows become the question + Revoke link / Cancel. **Cancel** →
   rows restore, menu open. **Revoke** again → **Revoke link** → submenu reads "Link
   revoked." with a **Share** row; menu still open. Choose **Share** → link rows are back.
5. **Regenerate** → same two-step with "Replace link"; the URL changes; menu open.
6. Press **←** → submenu closes, focus is on the Share row. Press **Escape** → the menu
   closes. Reopen, open Share, click outside the menu → everything closes at once.
7. On an agent that was never shared: the submenu shows "This agent is not shared." and
   one **Share** row.
8. Stop the API briefly, open Share → "Could not load the share link." + **Try again**;
   start the API, choose Try again → link rows, menu open.
9. Choose **Open in the app** → new tab with the app share page; the menu closes.
10. Choose **Tools** → menu closes, Tools sheet opens (also from a Settings section).
    Choose **Delete agent** → menu closes, confirm dialog opens. Choose **Edit** → the
    edit page.
11. While the agent is restarting: Restart item disabled, Stop disabled.

### Keyboard walk (SC-006)

Tab from the page start: Chat → Settings → usage line → Stop → ⋯. Enter on ⋯ opens the
menu; ↓ moves; → on Share opens the submenu with focus on its first row; ↓ reaches Copy
link; Enter copies and the menu stays; ← returns to Share; Escape closes the menu. In the
Settings list, Tab moves card to card; Enter opens that section beside the list.

### Twin console (FR-022)

Open the app console's `/agents/<id>`: unchanged — header with Share button, no tabs,
no usage line, no logs bar. Record in the PR: "app checked, nothing needed: no tabs,
usage strip, side logs or menu exist there".

## Done when

- All automated gates green.
- Every step above behaves as written; SC-004 (the menu never closes unexpectedly during
  the Share flow) and SC-005 (one poller) observed directly.
- PR into `main` with `CLEAN-123`, the twin-check line, and the PR URL on the Jira issue.
