# Contract — Send message, with attachments

An **additive** change to the two existing send routes. Nothing is removed or renamed, so the embed widget and the admin chat are unaffected.

```
POST /api/agent/:agentId/message        (fire & forget)
POST /api/agent/:agentId/message/sync   (used by the console)
```

The console calls the `sync` variant through the generated `sendBridleMessageSync`.

---

## Request — `SendMessageDto`

```ts
{
  text: string;                    // unchanged, required
  parts?: BridlePart[];            // unchanged
  images?: BridleImagePartDto[];   // unchanged (legacy)
  attachmentIds?: string[];        // NEW — optional, max 5, UUIDs from the upload route
}
```

Validated as `@IsOptional() @IsArray() @IsUUID('4', { each: true }) @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)`.

**Precedence** — the controller currently resolves `parts = body.parts ?? buildParts(body.text, body.images)`. The new field slots in without disturbing that:

1. If `parts` is supplied it still wins as the base, exactly as today.
2. Otherwise the base is built from `text` + `images`, exactly as today.
3. `attachmentIds`, if present, are expanded and **appended** to whatever base resulted.

An existing caller that sends no `attachmentIds` gets byte-identical behavior.

---

## Expansion (server-side)

For each id, in the order given:

| Kind | Appended to `parts[]` | Effect on `text` |
|---|---|---|
| `image` | `{ type: 'image', base64, mediaType }` — bytes read back from S3 | none |
| `text` | `{ type: 'file', url, name, mimeType }` | contents appended as a fenced block (below) |
| `binary` | `{ type: 'file', url, name, mimeType }` | none |

Images are read back from storage and encoded server-side rather than being sent inline by the browser — see D4. This is what actually reaches the model: the agent runtime folds image parts into the model call and drops file parts before it, so a `text`-kind file is only usable by the agent because its contents were inlined here.

**Inlined text block**

````
[Attached file: notes.md]
```
<decoded contents, up to MAX_EXTRACTED_TEXT_CHARS>
```
````

When truncated, the block ends with an explicit notice naming how much was removed, in the style the runtime already uses for over-long user messages:

```
[… 41,208 characters truncated — attached file was longer than the 100,000-character limit …]
```

**Strict decode**: contents are decoded as UTF-8 with fatal errors enabled. A file whose extension claims text but whose bytes do not decode — or that contains NUL bytes — is **downgraded to `binary`**: a `file` part only, no inlined text. Mojibake in the prompt is worse than a missing file.

---

## Validation at send

The per-message caps that a single upload cannot see are enforced here:

| Rule | Status on breach |
|---|---|
| More than `MAX_ATTACHMENTS_PER_MESSAGE` ids | `400` |
| Combined stored size over `MAX_MESSAGE_ATTACHMENT_BYTES` | `400` |
| An id that resolves to no stored object | `400`, naming the id |
| `text` empty **and** `attachmentIds` empty | `400` — unchanged; `text` is still `@IsNotEmpty()` |

On the last row: `text` remains required by the existing DTO. To satisfy FR-006 (send with attachments and no typed text), the **client** sends a single space or a short placeholder when the draft is empty and attachments are present, rather than relaxing the DTO — relaxing `@IsNotEmpty()` would change validation for every existing caller of a shared endpoint. Implementation note, flagged here because it is the kind of detail that otherwise gets discovered at the last minute.

---

## Response

Unchanged. The `sync` route still resolves `{ text, messageId, ts }` from the agent's `message` or `stream_end` event, with the same 120-second timeout.

---

## Hub → agent wire format

**Unchanged.** `parts[]` is exactly the shape the hub already forwards and the runtime already decodes (`wirePartsToMessageParts` handles `text`, `image`, `file`, `ui`, `ui_submit`). No protocol version bump, no runtime-repository change, no capability-handshake change.
