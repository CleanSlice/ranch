# Contract: transcript, chat history and export changes

## `GET /api/agent/:agentId/transcript` (operationId `getBridleTranscript`)

`TranscriptMessageDto` — `api/src/slices/bridle/dtos/transcript.dto.ts`

| Field | Before | After |
|---|---|---|
| `text` | full string the model received | **what the person typed** (attachment section removed per [agent-facing-document.md §5](./agent-facing-document.md)); may be `""` for attachment-only messages |
| `agentText` | – | **new, optional**: the full string the model received; present only for `user` messages whose text was split |
| `attachments` | metadata | unchanged |

Backwards compatibility: consumers that only read `text` see less text, never more. No field is removed.

## `GET /api/chat/:id/messages` and `GET /api/my/chats/:id/messages`

`ChatMessageDto` — `api/src/slices/chat/dtos/chatMessage.dto.ts`

| Field | Change |
|---|---|
| `text` | same semantics change as above |
| `attachments` | **new, optional** `TranscriptAttachmentDto[]` (id, name, mimeType, size, kind); names only, no download route in history |
| `agentText` | **new, optional**; included only when `types` contains `tool_call` or `tool_result` (the existing "debug" signal for history), otherwise omitted so ordinary browsing stays small |

## `GET /api/chat/:id/export?format=json|markdown|csv`

| Format | Change |
|---|---|
| `json` | messages carry `text` (typed), `attachments`, `agentText` as-is |
| `markdown` | user turn prints the typed text, then one line per attachment: `📎 <name> (<size>)`; the agent-facing text is not exported |
| `csv` | `text` column holds the typed text; new `attachments` column with names joined by `; ` |

## Front-end SDKs

After the API change: `cd api && bun run build && bun run generate:swagger`, then `cd admin && bun run build:api` and `cd app && bun run build:api`. No hand-written types.

## Admin agent chat (`admin/slices/bridle`)

- `IBridleMessageData.agentText?: string` — new.
- `toBridleMessage()` copies `text` and `agentText` from the page message.
- `Message.vue`: for `role === 'user'` with `agentText` and DEBUG on, renders a disclosure "What the agent received" (collapsed by default) with the text in a scrollable, monospace block capped at ~40 vh. Nothing when DEBUG is off.
- Chips: unchanged (`_hydrateAttachments`).

## Chat history bubbles (`admin/slices/chat`, `app/slices/chat`)

`Bubble.vue` in both slices: when `message.attachments?.length`, render one inert chip per attachment (file icon, name, size) above the text. App copy goes through `app/slices/chat/i18n/locales/en.json` and `bun run i18n:sync`; admin stays English-only.
