# Contract — Attachment endpoints

Two new routes on the existing `BridleController` (`@Controller('api/agent')`).

Both carry `@UseGuards(JwtAuthGuard)` **explicitly**. The guard is not global in this API and the existing bridle routes deliberately have none — see D3 in [research.md](../research.md). Omitting it publishes every uploaded file to the internet.

---

## 1. Upload an attachment

```
POST /api/agent/:agentId/attachment
```

| | |
|---|---|
| Auth | `Authorization: Bearer <jwt>` — required |
| Consumes | `multipart/form-data` |
| Field | `file` — exactly one file per request |
| `operationId` | `uploadBridleAttachment` |
| Interceptor | `FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } })` |
| Success | `200` |

Uploads are buffered in memory by multer. `diskStorage` is unavailable in this workspace — under Bun, `multer` is a phantom dependency of `@nestjs/platform-express` and `import { diskStorage } from 'multer'` does not resolve at runtime. The existing `reins/source` controller documents the same constraint.

One file per request, not a batch: it lets each chip report its own progress and its own failure, which FR-018 requires.

**Response** — wrapped by the global `{ success, data }` interceptor; `FlatResponse()` is applied as elsewhere in this controller.

```json
{
  "id": "9f1c7b3e-4a2d-4f18-9c55-0b7a1d3e6f22",
  "name": "quarterly-report.pdf",
  "mimeType": "application/pdf",
  "size": 284913,
  "kind": "binary",
  "url": "/api/agent/agent-abc/attachment/9f1c7b3e-4a2d-4f18-9c55-0b7a1d3e6f22",
  "readableByAgent": false
}
```

`kind` is one of `image` | `text` | `binary`. `readableByAgent` is `false` exactly when `kind === 'binary'`, and drives the FR-021 notice on the chip.

**Errors**

| Status | When | Body |
|---|---|---|
| `400` | Empty request, zero-byte file, or a MIME type off the allow-list | Message names the file and the accepted kinds |
| `413` | File exceeds `MAX_ATTACHMENT_BYTES` (10 MB) | Message names the limit |
| `401` | Missing or invalid bearer token | — |
| `400` | `integrations/s3_bucket` unset | Mirrors the existing `IFileGateway` message so the operator sees which setting to fix |

**Server-side behavior**

1. Resolve the MIME type from the uploaded bytes and the extension; do not trust the client's `mimetype` blindly.
2. Reject anything off the allow-list, zero-byte, or oversize.
3. Mint a UUID; derive the extension from the **resolved MIME type**, never from the supplied filename.
4. `S3Repository.upload({ bucket, key: 'agents/{agentId}/data/attachments/{uuid}{ext}', body, contentType })`.
5. Return the metadata above.

The per-message count and total-size caps are **not** enforced here — one upload cannot see the others. They are enforced at send (below) and mirrored in the client for immediate feedback.

---

## 2. Download an attachment

```
GET /api/agent/:agentId/attachment/:attachmentId
```

| | |
|---|---|
| Auth | `Authorization: Bearer <jwt>` — required |
| `operationId` | `getBridleAttachment` |
| Produces | The stored content type |
| Success | `200` with the raw bytes |

Uses `@Res()` to bypass the global `{ success, data }` envelope and set headers directly — the pattern already used by chat export, template export, and agent file export.

**Headers**

```
Content-Type: <stored ContentType>
Content-Length: <size>
Content-Disposition: inline; filename="<sanitized original name>"
Cache-Control: private, max-age=3600
```

`inline` so images render in a bubble and PDFs open in the browser's viewer; the browser still offers "save as". `private` keeps it out of shared caches.

**Errors**

| Status | When |
|---|---|
| `404` | No such object — the FR-024 "no longer available" state the UI renders |
| `401` | Missing or invalid bearer token |

---

## Constants

One module, imported by both routes and mirrored (not duplicated by hand) in the app:

```ts
MAX_ATTACHMENT_BYTES        = 10 * 1024 * 1024;   // per file
MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024;  // per message
MAX_ATTACHMENTS_PER_MESSAGE = 5;
MAX_EXTRACTED_TEXT_CHARS    = 100_000;
ALLOWED_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
];
```

---

## Regeneration

These endpoints do not exist for the app until the spec and SDK are regenerated, in this order:

```bash
cd api && bun run build && bun run generate:swagger   # → api/swagger-spec.json
cd app && bun run build:api                           # openapi-ts → #api
```

Hand-writing the client types instead is forbidden by `CLAUDE.md`.
