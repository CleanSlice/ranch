# Contract — Client-side preferences

**Feature**: [../spec.md](../spec.md) | **Date**: 2026-08-20

Two `localStorage` keys. Both are conveniences: a browser with storage unavailable or cleared
gets the documented default and the workspace works normally. Neither is synced to the server,
neither travels in a URL.

The repo already uses this pattern in `admin/slices/agent/agent/stores/agent.ts`
(`agent:pendingRestart`, `agent:restartInFlight`), including the try/catch-and-ignore around
every read and write. Follow it.

## `agent:settingsPanelOpen` — admin

| | |
|---|---|
| **Store** | `localStorage` |
| **Value** | `'1'` (open) or `'0'` (collapsed) |
| **Absent** | **Treated as open** — this is the FR-013 default |
| **Written** | Only on an explicit operator toggle |
| **Scope** | Global to the console, not per agent |

**Why absence means open rather than writing `'1'` on first visit**: a fresh browser and a
browser whose storage was cleared then behave identically to a first-ever visit, and the
default can be changed later by editing one line instead of migrating stored values.

**Interaction with `?tab=`** — the one rule worth stating explicitly:

```
?tab=<valid section> present  →  panel is open, regardless of the stored value
                              →  the stored value is NOT written
```

Following someone else's deep link must not silently change the preference of an operator who
keeps the panel collapsed. The forced-open state lasts until they navigate away or close the
panel themselves — and closing it *is* an explicit toggle, so that one does write.

**Reads/writes must be guarded**: `localStorage` throws in private-mode Safari and when quota
is exceeded. Swallow and fall back to the default, exactly as the existing agent store does.

## `agent:lastOpened` — app

| | |
|---|---|
| **Store** | `localStorage` |
| **Value** | An agent `id` string |
| **Absent** | Fall through to first `running`, then first in list |
| **Written** | On every successful workspace open, including rail switches |
| **Scope** | Per browser, per user session on that browser |

**Validation on read is mandatory.** The stored id is used **only** if it appears in the agent
list the user can currently see:

```ts
const remembered = read('agent:lastOpened');
const landing =
  agents.find(a => a.id === remembered)
  ?? agents.find(a => a.status === 'running')
  ?? agents[0]
  ?? null;
```

Without that check a deleted agent, a revoked visibility, or a different user on a shared
browser produces a landing on a dead id. With it, those are all non-events.

**Not written for**: a failed open (agent not found / unavailable). Remembering an id that
does not resolve would strand the user on the same broken landing on every visit.

## What is deliberately *not* persisted

| State | Why not |
|-------|---------|
| The expanded settings section | It is addressable — it lives in `?tab=`, so it can be shared. See [routes.md](./routes.md). |
| The rail's search term | Transient. A filter surviving a reload leaves someone staring at a rail that is missing agents with no memory of why. |
| Rail scroll position | Cheap to lose, confusing to restore against a list that may have changed. |
| The logs panel's open state | Existing behaviour, out of scope — this feature does not add persistence the logs panel does not already have. |
| The admin sidebar's collapsed state | Already handled by shadcn's `sidebar_state` cookie. Untouched. |
