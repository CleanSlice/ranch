# Phase 1 — Data Model: Chat File Attachments

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

No database table and no Prisma migration — see D5. The "model" here is the shape of the data in flight and at rest in S3 and `localStorage`.

---

## Entities

### 1. `StagedAttachment` (browser only, never serialized)

A file the person has chosen but not yet sent. Lives in the store keyed by `agentId`; discarded on send, on removal, or when the conversation is left.

| Field | Type | Notes |
|---|---|---|
| `localId` | `string` | Client-minted; identifies the chip before the server knows about the file. |
| `file` | `File` | The browser `File` handle. Never persisted. |
| `name` | `string` | From `file.name`. |
| `size` | `number` | Bytes. |
| `mimeType` | `string` | From `file.type`; may be empty for unusual files, in which case the extension decides. |
| `kind` | `AttachmentKind` | Derived — see below. |
| `previewUrl` | `string \| null` | Object URL for image thumbnails. **Must be revoked** on removal and on send. |
| `state` | `AttachmentState` | See state machine. |
| `progress` | `number` | 0–100, for the uploading state. |
| `remoteId` | `string \| null` | Server id once uploaded; this is what send transmits. |
| `error` | `string \| null` | A **translation key**, not a sentence (D9). |

**State machine**

```
  staged ──upload()──▶ uploading ──ok──▶ ready
                          │                │
                          └──fail──▶ failed┘   (retry() ──▶ uploading)

  any state ──remove()──▶ ✗ (revoke previewUrl)
```

- Sending is blocked while any attachment is `uploading` (FR-018 scenario 3) and while any is `failed` (scenario 4).
- Only `ready` attachments contribute a `remoteId` to the send call.

### 2. `AttachmentKind` (derived, shared vocabulary)

Derived once from MIME type with an extension fallback, and used by both sides to decide rendering and expansion.

| Kind | Matches | UI treatment | Server expansion (D4) |
|---|---|---|---|
| `image` | `image/png`, `image/jpeg`, `image/gif`, `image/webp` | Thumbnail | `image` part, base64 |
| `text` | `text/*`, `application/json`, `text/csv`, `text/markdown` | File entry | `file` part **+ contents inlined into `text`** |
| `binary` | everything else on the allow-list (currently `application/pdf`) | File entry, **flagged unreadable** | `file` part only |

Anything matching no kind is rejected at selection (FR-002). A file whose extension says `text` but whose bytes fail a strict UTF-8 decode is **downgraded to `binary`** at expansion time rather than inlining mojibake — the spec edge case.

### 3. `Attachment` (server response, and what a message carries)

Returned by the upload endpoint and stored on the message.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID) | Also the S3 object key stem. |
| `name` | `string` | Original filename, preserved for display. |
| `mimeType` | `string` | Resolved server-side, not blindly trusted from the client. |
| `size` | `number` | Bytes. |
| `kind` | `AttachmentKind` | As above. |
| `url` | `string` | Path of the authenticated download route — **not** an S3 URL. |
| `readableByAgent` | `boolean` | `false` for `binary`. Drives the FR-021 notice in the compose area. |

### 4. `IBridleMessage` — modified

The existing domain message gains one optional field. Everything else is unchanged, so old persisted conversations still parse.

```ts
export interface IBridleMessage {
  id: string;
  role: BridleRoleTypes;
  text: string;
  ts: number;
  attachments?: IBridleAttachment[];   // NEW — metadata only, never bytes
}
```

**Backward compatibility**: `hydrate()` reads whatever `localStorage` holds and only checks `Array.isArray` (verified in the current store), so messages written before this feature simply have no `attachments` key and render as they do today. No migration of stored conversations is needed.

### 5. Stored object (S3)

| Aspect | Value |
|---|---|
| Bucket | `settings → integrations → s3_bucket` (the agent data bucket) |
| Key | `agents/{agentId}/data/attachments/{uuid}{ext}` |
| `ContentType` | The resolved MIME type, set at upload so the download route can echo it back |
| Lifecycle | Removed with the agent by the existing `IFileGateway.wipe(agentId)` prefix delete |

`{ext}` is derived from the resolved MIME type, **not** from the user-supplied filename. The original name is kept only in the message metadata, so a hostile filename never reaches a key, a path, or a shell.

---

## Validation rules

Enforced in the browser for immediate feedback **and** re-enforced on the server, which is the only place that actually governs. The client copy is a convenience, never the control.

| Rule | Limit | Requirement | Failure |
|---|---|---|---|
| Per-file size | 10 MB | FR-003 | Reject that file, name the limit |
| Per-message total | 25 MB | FR-003 | Reject at the file that crosses it |
| Count | 5 | FR-004 | Disable the attach control, explain in tooltip |
| MIME allow-list | image/png, image/jpeg, image/gif, image/webp, application/pdf, text/plain, text/markdown, text/csv, application/json | FR-002 | Reject, name the file and the accepted kinds |
| Zero bytes | `size > 0` | Edge case | Reject with the same clarity as oversize |
| Extracted text | 100,000 chars | FR-020 | Truncate, append an explicit notice |

All six are constants in one module per side, not scattered literals — the spec requires them to be configurable rather than hard-coded.

---

## Layering

Direction of dependency is downward only; nothing in `domain/` imports from `data/`, `stores/`, or `components/`.

**API — `api/src/slices/bridle/`**

```
bridle.controller.ts        HTTP edge: guards, multipart, @Res() streaming
  └─▶ domain/attachment.service.ts     validation · text extraction · parts expansion
        └─▶ domain/attachment.gateway.ts   (abstract)
              └─▶ data/attachment.gateway.ts   S3Repository + bucket resolution
```

The service holds every rule and is where the unit tests point (D8). The gateway knows only about buckets, keys, and bytes.

**App — `app/slices/bridle/`**

```
components/…            Input · Provider · Message · AttachmentChip · AttachmentList · DropZone
  └─▶ stores/bridle.ts        staged drafts, upload orchestration, send
        └─▶ domain/bridle.service.ts
              └─▶ domain/bridle.gateway.ts   (abstract)
                    └─▶ data/bridle.gateway.ts   generated #api SDK + mapper
```

Composed as today in `plugins/di.ts`: `new BridleService(new BridleGateway())`.

---

## Store shape (app)

Additions to `useBridleStore`, keyed by `agentId` to match the existing `conversations` / `pending` / `errors` idiom:

```ts
const staged = ref<Record<string, StagedAttachment[]>>({});

// selectors
stagedFor(agentId): StagedAttachment[]
canSend(agentId): boolean        // text or ready attachment, none uploading, none failed

// actions
stageFiles(agentId, files: FileList | File[]): void   // validate → push → upload each
removeStaged(agentId, localId): void                  // revokes previewUrl
retryStaged(agentId, localId): void
clearStaged(agentId): void                            // revokes every previewUrl
sendMessage(agentId, text): Promise<void>             // now sends attachmentIds too
```

`sendMessage` keeps its current optimistic-append shape: it pushes the user message — now carrying `attachments` — before awaiting the reply, so the bubble with its thumbnails appears immediately.

---

## Traceability

| Requirement | Where it lives |
|---|---|
| FR-001, FR-005, FR-006 | `StagedAttachment`, store selectors, `Input.vue` + `AttachmentChip.vue` |
| FR-002, FR-003, FR-004 | Validation rules table, enforced both sides |
| FR-007 | `disabled` already threaded through `Input.vue`, extended to the attach control |
| FR-008 – FR-013 | `DropZone.vue` + drag state in `Provider.vue` (D6) |
| FR-014, FR-017 | Stored object; send blocked unless every attachment is `ready` |
| FR-015 | Authenticated download route (D2, D3); no S3 URL leaves the API |
| FR-016, FR-019, FR-020, FR-021 | `AttachmentKind` expansion table (D4) |
| FR-018 | `failed` state + `retryStaged` |
| FR-022, FR-023 | `IBridleMessage.attachments` + `AttachmentList.vue` |
| FR-024 | Download route 404 → explicit unavailable state |
| FR-025 | `en.json` keys; `error` fields hold keys, not sentences |
| FR-026 | Component contracts in [contracts/ui-components.md](./contracts/ui-components.md) |
| FR-027 | Only `app/slices/bridle` and `api/src/slices/bridle` are touched |
