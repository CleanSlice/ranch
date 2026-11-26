# Contract: UI (app console)

What each piece is given, what it emits and what a browser check can hook onto. Requirement numbers are from [spec.md](../spec.md); state shapes from [data-model.md](../data-model.md).

## Addresses

| Address | Shows |
|---------|-------|
| `/agents/:id` | the chat |
| `/agents/:id?view=history` | the list |
| `/agents/:id?view=history&chat=<conversationId>` | one closed conversation |
| `/chats` | redirects to `/agents` |
| `/chats/:id` | redirects into the agent of that conversation; "not found" when there is none |

Every change of view is a push, so Back steps list ← conversation and chat ← list.

## `agent` slice

### `utils/panelView.ts` (pure)

- `parsePanelView(query) → { kind: 'chat' } | { kind: 'list' } | { kind: 'conversation', chatId }`
- `panelLocation(agentId, view) → { path, query }`
- `stepBack(view) → view | null`
- `counterLabel(total) → string | null` (`null`, `'1'..'99'`, `'99+'`)

### `composables/useAgentPanelView(agentId)`

Returns `view` (computed from the route), `toChat()`, `toList()`, `toConversation(chatId)`, `back()`. Owns the Escape listener described in research R8.

### `AgentWorkspaceSheet`

Fold line, left to right: identity · **conversation group** · agent actions and the fold toggle.

Conversation group:

| Element | Behaviour | Hook |
|---------|-----------|------|
| group | `role="group"`, labelled | `data-panel-switch` |
| Chat | `aria-pressed` when the view is the chat; click → `toChat()` | `data-panel-view="chat"` |
| History | `aria-pressed` when the view is the list or a conversation; click → `toList()`; shows the counter | `data-panel-view="history"` |
| counter | `counterLabel(closedCountFor(agentId))`; absent when `null`; exact number in the button's accessible name | `data-history-count` |
| New chat | the existing `BridleChatNewChat`; on `confirmed` → `toChat()` | existing |

Below 700 px of sheet width the two labels and the New chat label are visually hidden; names, tooltips and the counter remain (FR-003, FR-030).

### `AgentWorkspaceProvider`

Under the sheet: `AgentChatProvider` always mounted, hidden unless the view is the chat; `ChatHistoryProvider` rendered when it is not. Loads the agent's first history page when the agent opens.

## `chat` slice

### `ChatHistoryProvider`

Props: `agentId`, `view` (`list` or `conversation` with `chatId`).
Emits: `open(chatId)`, `to-chat`, `back`.
Keeps `List` mounted (hidden) while a conversation is read, so its scroll and search survive (FR-016).

### `ChatHistoryList`

| Part | Behaviour | Hook |
|------|-----------|------|
| search field | focused when the list appears; 250 ms after the last keystroke → `loadHistory(agentId, text)` | `data-history-search` |
| Sync | `syncHistory(agentId)`, spinning while it runs | `data-history-sync` |
| running row | first, marked as going on now; click → `to-chat` | `data-history-row` `data-state="running"` |
| group heading | Today, This week, Earlier; only non-empty groups | `data-history-group` |
| closed row | title, last message (one line), Closed, resolved or not resolved when assessed, message count, time; click → `open(id)` | `data-history-row` `data-state="closed"` |
| end of list | loads the next page when reached, while `hasMore` | `data-history-more` |
| states | first load: skeleton rows. No conversations: empty state. Search with no match: says so and names what search covers. Failure: message and Retry | `data-history-state="loading|empty|no-match|error"` |

Rows are buttons in document order; arrow keys are not required, Tab and Enter are.

### `ChatHistoryConversation`

Props: `chatId`. Emits: `back`, `to-chat`.

| Part | Behaviour | Hook |
|------|-----------|------|
| bar | back control (→ `back`), title, Closed mark; Overview control only when the Overview is not beside the messages | `data-conversation-bar`, `data-overview-toggle` |
| messages | as the old page: load older upwards, thinking above the reply, sources open and rate, reply ratings | `data-msg-id` (existing) |
| read-only line | where the composer was: says the conversation is closed; one button → `to-chat` | `data-read-only` |
| not found | text and a control → `back` | `data-conversation-state="not-found"` |

A record that is not archived makes the component emit `to-chat` instead of rendering.

### `ChatHistoryOverview`

Props: the conversation record, the navigation items. Emits: `jump(messageId)`, `export(format)`.

Four parts in this order, with the content of the old right rail: counts (messages, last activity) · Summary & insights (sentiment, resolved, language, topics, summary or "no summary yet") · Navigation · Export (JSON, MD, CSV).

Layout by the reading view's own width: at 880 px and above, a 300 px column to the right of the messages, always shown; below, closed on open, shown over the messages by the bar's control (`aria-expanded`), closed by the control, by Escape and by `jump`. Hook: `data-overview`, `data-overview-mode="column|overlay"`.

## `bridle` slice

`BridleChatNewChat` emits `confirmed` after the person confirms, before the request. No other change; the share page ignores the event.

## `common` slice

- Layout: the Agents and History tabs are removed; the logo keeps leading to the agents.
- Landing header and footer: the History links are removed.

## Copy (English source)

New keys, by slice. Russian is generated.

`chat`: `history.search`, `history.search_none`, `history.search_scope`, `history.group_today`, `history.group_this_week`, `history.group_earlier`, `history.running`, `history.empty_agent_title`, `history.empty_agent_hint`, `history.load_failed`, `history.retry`, `history.back`, `session.read_only`, `session.to_current`, `session.overview`, `session.overview_show`, `session.overview_hide`.

`agent`: `sheet.view_label`, `sheet.view_chat`, `sheet.view_history`, `sheet.view_history_count` (plural, for the accessible name).

Removed with the page: `history.title`, `history.lede`, `history.filter_current`, `history.filter_earlier`, `history.empty_title`, `history.empty_hint`, `history.empty_cta`, `history.empty_earlier_title`, `history.empty_earlier_hint`, `session.refresh`, and `nav.history` in `common`. Each is grepped before removal; `chat.new_chat_confirm_console` still says the conversation "moves to your history" and stays true.
