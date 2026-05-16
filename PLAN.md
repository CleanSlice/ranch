# PLAN — Auto-load transcripts + large-file viewer

## Problem

1. `bridle:admin.jsonl` (385 KB) exceeds `MAX_BYTES = 256 KB` in [api/src/slices/agent/file/data/file.gateway.ts:22](api/src/slices/agent/file/data/file.gateway.ts#L22).
   - **Chat** (`/agents/:id/transcript`) silently returns `{ messages: [] }` — user sees empty chat.
   - **Files viewer** in admin gets a 400 → frontend store crashes on `env.data` of undefined.

## High-level approach

Two independent fixes, both lazy:

- **Chat transcript** — change `GET /agents/:id/transcript` to a tail-first paginated endpoint. Default returns the most recent N messages + a cursor; admin chat UI requests older pages when the user scrolls to the top.
- **File viewer** — add `range` support to `GET /agents/:id/files/content`. Default returns the first chunk + a `hasMore` flag for binary-safe text files; UI shows a "Load more" button (or auto-loads on scroll bottom).

The 256 KB write cap stays — it's about edit safety. The new endpoints bypass it for read-only access by streaming/chunking instead of loading the whole file into memory.

## Slices & responsibilities

| Slice | Layer | Change |
|---|---|---|
| `bridle` (api) | controller + dto | New `?limit`+`?cursor` query, paginated response, tail-first parsing |
| `agent/file` (api) | gateway + controller + dto | New `readRange(agentId, path, offset, limit)` method; controller exposes `?offset=&limit=` |
| `bridle` (admin) | store + Provider | First load fetches latest page, scroll-up triggers older-page fetch with cursor |
| `agent/file` (admin) | store + Viewer | Chunked load: first 256 KB by default, "Load more" appends next chunk |

## API endpoints

| Method | Endpoint | Change |
|---|---|---|
| GET | `/agents/:agentId/transcript` | Add `limit` (default 50) and `cursor` (opaque). Response gains `nextCursor: string \| null`, `hasMore: boolean` |
| GET | `/agents/:agentId/files/content` | Add `offset` (default 0) and `limit` (default 262144). Response gains `totalSize`, `nextOffset \| null`, `hasMore`. Existing `content/size/updatedAt` keep their meaning for the returned slice. |

## Database changes

None — sessions live in S3/MinIO, not in Prisma.

## Tech stack

FIXED — NestJS + Nuxt + Pinia + shadcn-vue. No new dependencies.

## Detailed plan

### API — agent/file slice

- `domain/file.gateway.ts`
  - Add `abstract readRange(agentId: string, path: string, offset: number, limit: number): Promise<IFileChunk>`
- `domain/file.types.ts`
  - Add `IFileChunk { path, content, size, totalSize, offset, nextOffset: number | null, hasMore: boolean, updatedAt }`
- `data/file.gateway.ts`
  - Implement `readRange` using S3 `GetObjectCommand` with `Range: bytes=offset-end`
  - `HeadObjectCommand` first to get `ContentLength` for `totalSize`
  - Cap `limit` at `MAX_READ_CHUNK = 512 * 1024` (twice the edit cap; range read is cheap)
  - Keep existing `read()` as-is for now (it still enforces `MAX_BYTES` for save flow)
- `file.controller.ts`
  - `GET content` accepts `@Query() ReadFileQueryDto` (path + offset + limit), delegates to `readRange`
  - Backward-compat: omitted offset/limit → first 256 KB chunk
- `dtos/`
  - New `readFile.query.dto.ts` (path: string, offset?: number, limit?: number)
  - New `fileChunk.dto.ts` for response

### API — bridle slice

- `dtos/transcript.dto.ts`
  - Add `nextCursor?: string`, `hasMore: boolean` to `TranscriptResponseDto`
  - New `TranscriptQueryDto` (channel?: string, limit?: number, cursor?: string)
- `bridle.controller.ts:transcript`
  - Drop `fileGateway.read` (256 KB blocker), use new `fileGateway.readRange` in reverse
  - Strategy: read file size via `HeadObject` (already inside `readRange`), then read **from end** in 64 KB blocks until N user/assistant messages collected (cursor = byte offset). Stream-style, never loads whole file.
  - On 404 → empty page, hasMore=false
  - Cursor format: base64 of the byte offset to read backward from (opaque string in DTO)
- Helper in `bridle.gateway.ts` (data layer) — keeps controller thin per CleanSlice rules. Method: `loadTranscriptPage(agentId, channel, limit, cursor): Promise<TranscriptPage>`

### Admin — agent/file slice

- `stores/agentFile.ts`
  - Update `fetchContent` to `fetchContent(agentId, path, offset?, limit?)` and return `IFileChunk`
  - Handle the envelope properly (`res.data?.data ?? throw new Error(res.error)`)
- `components/agentFile/Provider.vue`
  - Track `loadedSize` per open file
  - Append on "Load more" — `content = original + chunk.content`
  - Disable editor when `hasMore` (it's a partial file — editing would truncate)
- `components/agentFile/Viewer.vue`
  - Show "Loaded X KB of Y KB" hint + "Load more" button when `hasMore`

### Admin — bridle slice

- `stores/bridle.ts`
  - Add `nextCursor`, `hasMoreOlder` state
  - `loadTranscript` becomes initial-page fetch
  - New action `loadOlderTranscript()` — fetches next page, **prepends** to `messages`
  - SDK call: switch from raw `fetch` to generated `BridleService.getBridleTranscript` (consistent with other admin slices)
- `components/bridle/Provider.vue`
  - On scroll near top of ScrollArea viewport → call `loadOlderTranscript()`
  - Preserve scroll position after prepend (compute delta of scrollHeight before/after)
  - Visual "Load older messages…" spinner near top while loading

## Files affected

| Path | Change |
|---|---|
| `api/src/slices/agent/file/domain/file.gateway.ts` | add `readRange` |
| `api/src/slices/agent/file/domain/file.types.ts` | add `IFileChunk` |
| `api/src/slices/agent/file/data/file.gateway.ts` | impl `readRange` via S3 Range |
| `api/src/slices/agent/file/dtos/readFile.query.dto.ts` | new |
| `api/src/slices/agent/file/dtos/fileChunk.dto.ts` | new |
| `api/src/slices/agent/file/dtos/index.ts` | export |
| `api/src/slices/agent/file/file.controller.ts` | use new query DTO, return chunk |
| `api/src/slices/bridle/dtos/transcript.dto.ts` | add cursor fields + query DTO |
| `api/src/slices/bridle/dtos/index.ts` | export |
| `api/src/slices/bridle/data/bridle.gateway.ts` | impl `loadTranscriptPage` |
| `api/src/slices/bridle/domain/bridle.gateway.ts` | abstract `loadTranscriptPage` |
| `api/src/slices/bridle/bridle.controller.ts` | thin out, use new gateway method |
| `admin/slices/agent/file/stores/agentFile.ts` | chunked fetchContent |
| `admin/slices/agent/file/components/agentFile/Provider.vue` | append-on-load + disable edit on partial |
| `admin/slices/agent/file/components/agentFile/Viewer.vue` | "Load more" button + size hint |
| `admin/slices/bridle/stores/bridle.ts` | pagination state + loadOlder action |
| `admin/slices/bridle/components/bridle/Provider.vue` | scroll-top auto-load + position preserve |

## Edge cases

- **Empty file / 404** — returns `content=''`, `totalSize=0`, `hasMore=false`. No crash.
- **Multi-line JSONL message** — JSONL writers always end each event with `\n`, so reading backwards by newline boundaries is safe.
- **Cursor races vs. live socket** — chat append from WS still goes to the end of `messages`. Pagination only prepends. They don't collide.
- **Edit on partial** — disabled in Viewer (the only writable extensions are `.md/.json` and a partial `.json` would fail validation anyway, but explicit is clearer).
- **Backward compat** — existing callers that don't pass `offset`/`limit` get the first 256 KB. Same shape just with `hasMore=false` if the file fits.

## Test plan (manual)

1. Open the broken agent (`agent-31a6fbd1-...`) chat — should show recent messages, scroll up loads older.
2. Open Files → `bridle:admin.jsonl` — should display first 256 KB with "Load more" prompt.
3. Open a small file (`access.json`) — should display as before, no "Load more".
4. Reset chat — empty state still works.
5. Edit `MEMORY.md` (small file) — save still works.

## Rollback

Pure addition: new query params default to original behavior. Reverting means undoing the four commits.

---

**Approve to proceed.**
