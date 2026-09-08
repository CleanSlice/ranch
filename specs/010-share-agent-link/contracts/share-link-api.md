# Contract: share-link API (CLEAN-66)

All 2xx bodies are wrapped by the API's standard envelope `{ success, data }`; shapes below are the `data` payload. DTOs carry `@ApiProperty` so `bun run generate:swagger` → `cd app && bun run build:api` produces `ShareLinksService.*` / `ShareService.*` in the generated SDK. Set explicit `operationId`s as listed.

## Owner side — `ShareLinkController` (`@Controller('agents/:agentId/share-link')`, `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(User)`: any console user — Owner, Admin or User; agent-runtime `Agent` tokens are refused)

| Method | Path | operationId | Response `data` | Errors |
|---|---|---|---|---|
| `GET` | `/agents/:agentId/share-link` | `getAgentShareLink` | `ShareLinkDto` | 401 no/invalid JWT · 404 agent not found |
| `POST` | `/agents/:agentId/share-link` | `createAgentShareLink` | `ShareLinkDto` (existing active link returned unchanged; new token when none/revoked) | 401 · 404 |
| `POST` | `/agents/:agentId/share-link/regenerate` | `regenerateAgentShareLink` | `ShareLinkDto` (always a new token) | 401 · 404 |
| `DELETE` | `/agents/:agentId/share-link` | `revokeAgentShareLink` | `ShareLinkDto` (`active: false`) | 401 · 404 |

`ShareLinkDto`
```json
{
  "active": true,
  "token": "sl_…",            // null when active=false
  "createdAt": "2026-09-07T10:00:00.000Z",   // null when no row yet
  "revokedAt": null,
  "rotatedAt": null,
  "rotationCount": 0
}
```
The API never builds the URL; the console renders `${location.origin}/share?token=${token}`.

## Visitor side — `ShareController` (`@Controller('share')`, unguarded)

| Method | Path | operationId | Body | Response `data` | Errors |
|---|---|---|---|---|---|
| `POST` | `/share/resolve` | `resolveShareLink` | `{ "token": "sl_…" }` | `ShareResolvedDto` | 404 `SHARE_LINK_NOT_FOUND` for unknown **and** revoked tokens (identical body, FR-013) · 400 malformed body |

`ShareResolvedDto`
```json
{ "agentId": "uuid", "agentName": "Support bot", "agentStatus": "running" }
```
`agentStatus` is the agent's persisted status (`running | unreachable | deploying | stopped | failed | …`). Nothing else from the agent is exposed.

## Chat — existing `BridleController` (`/api/agent`), new header pair

`POST /api/agent/:agentId/message/sync` (and `/message`) accept:

| Header | Value | Rule |
|---|---|---|
| `X-Share-Token` | `sl_…` | must resolve to an **active** link whose `agentId` equals the path param |
| `X-Share-Visitor` | visitor id | `/^[A-Za-z0-9_-]{1,64}$/` |

Resolution order in `resolveClientId`: JWT bearer (unchanged) → share headers → `null` (existing anonymous fallback).

| Condition | Result |
|---|---|
| valid token + valid visitor | `clientId = share-<visitor>`; request proceeds |
| token present but unknown / revoked / other agent | **403** `{ code: 'SHARE_LINK_INVALID' }` — never falls back to anonymous |
| token present, visitor missing/malformed | **403** `{ code: 'SHARE_VISITOR_INVALID' }` |
| no share headers | unchanged behaviour |

403 (not 401) on purpose: the console's axios interceptor redirects 401s to `/login`.

### Attachments — same controller, guard swapped

`POST /api/agent/:agentId/attachment` and `GET /api/agent/:agentId/attachment/:attachmentId` move from `JwtAuthGuard` to `BridleChatAuthGuard`:

| Caller | Accepted when | `req.chatClientId` |
|---|---|---|
| JWT bearer | token valid (unchanged) | `admin` or `sub` |
| share visitor | `X-Share-Token` active for path `agentId` **and** `X-Share-Visitor` valid | `share-<visitor>` |
| neither | — | **401** for missing credentials (console interceptor bounces console users as today); **403** `SHARE_LINK_INVALID` / `SHARE_VISITOR_INVALID` when share headers are present but rejected |

Upload stamps `owner = req.chatClientId` into the object metadata. Download for a share visitor returns **404** unless `owner === share-<visitor>`; JWT callers are not owner-checked. Response shapes (`BridleAttachmentDto`, raw bytes with `Content-Disposition: inline`) are unchanged.

## Console routes (app)

| Route | Layout | Auth | Behaviour |
|---|---|---|---|
| `/agents/:id` | default | required (existing) | header gains `<SharePanelProvider :agent-id>` next to Restart |
| `/share?token=sl_…` | `blank` | none | resolve → full-view chat with attachments; 404 → "link is invalid or no longer active"; re-resolve on visibility + every 30 s |

## Chat component contract (app, `BridleChatProvider`)

```ts
props: {
  agentId: string | null;
  conversation?: { key: string; agentId: string; share?: { token: string; visitorId: string } }; // default { key: agentId, agentId }
  title?: string; subtitle?: string; showHeader?: boolean;
}
```
`useBridleStore` methods (`hydrate`, `sendMessage`, `messagesFor`, `isPending`, `errorFor`, `stageFiles`, `clearStaged`, `reset`) take the descriptor `key` instead of a bare `agentId`; `sendMessage`, `stageFiles` (upload) and `fetchAttachment` forward `share` to the gateway, which sets the two headers per request (never via the shared client config).
