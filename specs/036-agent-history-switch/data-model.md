# Data Model: Chat History Inside the Agent

Nothing is added to the database. This file describes what the app holds and how the panel's state is derived.

## Conversation (existing, `ChatSession` → `IChatSession`)

Unchanged. Fields this feature reads:

| Field | Use |
|-------|-----|
| `id` | key in the store, `chat` in the address |
| `agentId` | which agent's history it belongs to; target of the old-address redirect |
| `title`, `summary` | row and bar heading: title, else the first 80 characters of the summary, else the fallback word |
| `preview` | the last-message line of the row |
| `archived` | `false`: going on now. `true`: closed, read-only |
| `messageCount`, `lastMessageAt` | row meta, Overview counts, grouping and order |
| `insights` (`sentiment`, `resolved`, `language`, `topics`) | resolved mark in the row; all four in the Overview. `null` means not assessed: no mark |

Ownership is the server's rule and does not change: `channel = bridle`, `externalUserId` = the caller, agent reachable by the caller.

## Chat store (app, `useChatStore`)

```text
byId:     Record<conversationId, IChatSession>
history:  Record<agentId, AgentHistory>

AgentHistory
  currentIds:   string[]        // archived = false, newest first; normally 0 or 1
  closedIds:    string[]        // archived = true, pages appended in order
  closedTotal:  number | null   // from an unsearched answer only; null = not known yet
  search:       string          // what closedIds currently answers
  page:         number          // last loaded page of closedIds
  hasMore:      boolean         // closedIds.length < total of the current search
  status:       'idle' | 'loading' | 'loading-more' | 'error'
  generation:   number          // bumped on every new first-page request
```

**Rules**

- Every answer that carries conversations upserts them into `byId` first; lists hold ids only. `getMine(id)` upserts too.
- `loadHistory(agentId, search = '')` bumps `generation`, asks for the running list and page 1 of the closed list in parallel, and writes the answer only if `generation` is still the one it started with and the account has not changed.
- `closedTotal` is written when `search` is empty. A searched answer never touches it.
- `loadMoreHistory(agentId)` appends the next page for the current `search`; ignored while a load is in flight or when `hasMore` is false.
- `refreshHistory(agentId)` reloads page 1 with the current `search`; `syncHistory(agentId)` calls `syncMine(agentId)` and then refreshes.
- `closedCountFor(agentId)` returns `closedTotal` (or `null`), the counter's only source.
- `resetForAccount()` empties `byId` and `history`.
- Removed: `sessions`, `showArchived`, `setShowArchived`, the page-shaped `listMine()`.

**Getters for components**: `currentFor(agentId)`, `closedFor(agentId)` (records in order), `historyStateFor(agentId)` (`status`, `hasMore`, `search`).

## Panel view (derived, not stored)

Read from the agent page's query by `agent/utils/panelView.ts`:

| Address | View |
|---------|------|
| `/agents/:id` | `{ kind: 'chat' }` |
| `/agents/:id?view=history` | `{ kind: 'list' }` |
| `/agents/:id?view=history&chat=<id>` | `{ kind: 'conversation', chatId }` |
| any other `view` value, or `chat` without `view=history` | `{ kind: 'chat' }` |

**Transitions**

```text
chat ──History──▶ list ──pick closed──▶ conversation
  ▲                 │  ▲                    │
  │◀──Chat / Esc────┘  └────back / Esc──────┘
  │◀──────── to current chat / Chat / New chat confirmed ─────────┘
list ──pick running──▶ chat
any  ──another agent──▶ chat (of that agent)
```

`stepBack(view)`: conversation → list, list → chat, chat → nothing.

A `conversation` view whose record turns out to be the running one (`archived = false`) is replaced by the chat view. One whose fetch answers 404 shows "not found" with the way back to the list.

## State local to a component

| State | Component | Lifetime |
|-------|-----------|----------|
| search field text (before debounce) | `List.vue` | cleared on leaving History; restored from `history[agentId].search` when coming back from a conversation |
| loaded messages, cursor, the person's ratings | `Conversation.vue` | one opened conversation (see the waiver in plan.md) |
| Overview open over the messages | `Conversation.vue` | one opened conversation; always closed on open |
| list scroll position | `List.vue`, kept mounted while a conversation is read | until History is left |

## Day groups (`chat/utils/historyGroups.ts`)

`groupClosed(conversations, now)` → ordered groups `today`, `this_week`, `earlier`, each with its conversations, empty groups omitted.

- `today`: `lastMessageAt` falls on the local calendar day of `now`.
- `this_week`: on one of the six local days before that.
- `earlier`: anything older, and any row whose date cannot be parsed.

Input order is preserved inside a group.

## Counter (`agent` sheet)

`null` or `0` → not shown. `1..99` → the number. `> 99` → `99+`. The accessible name always carries the exact number.
