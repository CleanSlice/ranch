# Contract: Ranch API — routes, DTO additions, agent tools

**Feature**: [../spec.md](../spec.md) · **Decisions**: [../research.md](../research.md) R7–R11 · **Wire shapes**: [sources.md](./sources.md)

All DTO changes flow into the consoles through OpenAPI regen
(`cd api && bun run build`, then `bun run build:api` in `admin/` and `app/`).

## 1. Reader routes — `api/agent/:agentId/…` (`bridle.controller.ts`)

Guard: `BridleChatAuthGuard` — resolves the requester to `clientId` =
`admin` (Owner/Admin JWT) · console `sub` (JWT) · `share-<visitorId>`
(`X-Share-Token` + `X-Share-Visitor`). Anonymous → 401.

Common precondition **"cited to this reader"**: a `ChatMessageSource` row with
`(agentId, messageId, n)` exists and `row.clientId === requester.clientId`, or
requester is `admin`. Otherwise **404** (not 403 — the route does not confirm
that a citation exists for someone else).

### `GET api/agent/:agentId/message/:messageId/source/:n/content`

Opens a cited knowledge document.

| Check | Failure |
|---|---|
| cited to this reader | 404 |
| `row.kind === 'knowledge'` and `row.sourceId !== null` | 404 (web sources are opened by their URL; a deleted source is gone — FR-017) |
| `Knowledge.readerAccess === 'open'` for `row.knowledgeId`, **or** requester is `admin` | 403 `{ code: 'READER_ACCESS_CLOSED' }` |

Query: `disposition=inline|attachment` (default `inline`), same semantics and
headers as the admin route (`source.controller.ts:164`). Streams through
`SourceService.readContent`. The policy is read on every request (FR-016c).

### `PUT api/agent/:agentId/message/:messageId/source/:n/rating`

Body `{ rating: 1 | -1 }` (`@IsIn([1,-1])`). Upsert on
`(sourceId, messageId, authorId)` with `authorId = requester.clientId`.
Preconditions: cited to this reader; `kind === 'knowledge'`; `sourceId !== null`
(410 `{ code: 'SOURCE_GONE' }` otherwise — FR-017). Returns `{ rating }`. 200.

### `DELETE api/agent/:agentId/message/:messageId/source/:n/rating`

Withdraws the requester's rating. 204 whether or not a row existed.

### `GET api/agent/:agentId/transcript` (existing) — response change

Each `TranscriptMessageDto` may carry `sources?: SourceEntryDto[]`
(shape §4), overlaid from `ChatMessageSource` by `messageId`, with `canOpen`
and `myRating` computed for the requester at serve time.

### `POST api/agent/:agentId/message/sync` (existing) — behaviour change

Reply `text` has every `[^n]` marker removed (FR-036). Shape unchanged.

## 2. History routes (existing) — response change

- `GET chats/:id/messages` (admin, `chat.controller.ts`)
- `GET me/chats/:id/messages` (console user, `myChat.controller.ts`)

`ChatMessageDto` gains `sources?: SourceEntryDto[]`, overlaid the same way;
`myRating` is for the caller (`admin` / `sub`).

## 3. Knowledge console routes (existing, `reins`, admin)

### `PUT knowledges/:id`

`UpdateKnowledgeDto` gains `readerAccess?: 'closed' | 'open'`
(`@IsIn(['closed','open'])`). `KnowledgeDto` gains `readerAccess`.

### `GET knowledges/:knowledgeId/sources`

`FilterSourcesDto` gains
`sort?: 'createdAt' | 'cited' | 'likes' | 'dislikes'` and
`order?: 'asc' | 'desc'` (defaults `createdAt asc`, today's order).
`SourceDto` gains `cited: number`, `likes: number`, `dislikes: number`
(zero when none — FR-029).

## 4. `SourceEntryDto` (shared by transcript and chat history)

```ts
class SourceEntryDto {
  n: number;                         // 1-based, dense within the message
  kind: 'knowledge' | 'web';
  name: string;
  url?: string;                      // web only, https? only
  knowledgeName?: string | null;     // knowledge only
  canOpen: boolean;                  // knowledge: policy open (or admin) AND source exists; web: true
  myRating?: 1 | -1;                 // knowledge only
}
```

Never present: `sourceId`, `knowledgeId`, storage URIs, excerpts (FR-035).

## 5. Hub-internal: `sources` socket event from the runtime

Handled in `bridleAgentWs.handler.ts` as `@SubscribeMessage('sources')`:

1. Shape check (`clientId`, `messageId`, `text: string`, `sources: ISource[]`,
   `≤ 50` entries, web `url` is `https?`). Invalid → warn + drop.
2. `ChatSourceService.record({ agentId, clientId, sessionKey: 'bridle:'+clientId, messageId, sources })`
   — upsert on `(messageId, n)`; knowledge entries resolve `knowledgeName` from
   the frame (already there) and keep `sourceId` only if the `Source` row
   exists (else `null`, name kept).
3. Relay `{ type: 'sources', messageId, text, sources: SourceEntryDto[] }` to
   the client via the existing `route()` (gets a `seq`, replay-buffered like
   any frame).

## 6. Agent tools (operator audience, `ToolTopics.Knowledge`)

| Tool | Params | Notes |
|---|---|---|
| `set_knowledge_reader_access` *(new, `knowledgeAdmin.tool.ts`)* | `{ id, access: 'open'\|'closed', confirm }` | `destructive: true`; `confirmed(args, 'let readers of agent answers open documents of «name»')`; description ends with `CONFIRM_SENTENCE`; result echoes `{ id, name, readerAccess }` |
| `get_knowledge` *(existing)* | — | result now includes `readerAccess` (comes for free from the DTO) |
| `list_knowledge_sources` *(existing, `source.tool.ts`)* | `+ sort?, order?` | rows include `cited`, `likes`, `dislikes` — what the console column shows |

Specs: `knowledgeAdmin.tool.spec.ts`, `source.tool.spec.ts` — listed only for
operator; `set_knowledge_reader_access` refuses without `confirm` and touches
nothing; no secrets in results.

## 7. Error codes introduced

| Code | Where | Meaning |
|---|---|---|
| `READER_ACCESS_CLOSED` | content route, 403 | base policy is `closed` for a non-admin |
| `SOURCE_GONE` | rating route, 410 | the knowledge source was deleted after it was cited |
