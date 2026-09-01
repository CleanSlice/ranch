# Contract — UI components

Nuxt auto-imports components from the slice by path, so `components/bridle/chat/AttachmentChip.vue` resolves as `<BridleChatAttachmentChip>`. This mirrors the existing `BridleChatInput` / `BridleChatMessage` / `BridleChatEmpty`.

---

## `BridleChatInput` — modified

```ts
props: {
  disabled?: boolean;              // unchanged
  agentId: string;                 // NEW — the store is keyed by it
}
emits: {
  send: [text: string];            // unchanged signature; attachments ride in the store
}
```

**Behavioral additions**

- A paperclip button left of the textarea, before the send button. Disabled when `disabled`, or when the staged count has reached the cap; the disabled tooltip explains which.
- A hidden `<input type="file" multiple>` with `accept` set from the allow-list, opened by the paperclip.
- Staged chips render above the textarea, inside the same rounded container, so the compose area grows as one block.
- `@paste` handler: image items on the clipboard are staged like any other file (spec edge case).
- The send button enables when there is trimmed text **or** at least one `ready` attachment, and disables while any attachment is `uploading` or `failed`.
- The existing keyboard contract is untouched — Enter sends, Shift+Enter newlines, and the `chat.input_hint` line stays as is.

---

## `BridleChatAttachmentChip` — new

```ts
props: {
  attachment: StagedAttachment;
}
emits: {
  remove: [localId: string];
  retry:  [localId: string];
}
```

Renders one staged file:

- Image kinds show the `previewUrl` thumbnail; others show a kind icon (`file-text`, `image`, `paperclip`).
- Name truncated in the middle with the extension preserved, full name in `title` (FR-019 scenario 5).
- Size formatted human-readably.
- `uploading` → a determinate progress indicator; `failed` → error styling plus a retry control; `ready` → plain.
- When `readableByAgent === false`, a small notice that the agent will see the name but not the contents (FR-021).
- Remove control is a real `<button>` with an `aria-label`, focusable and Enter/Space activatable (FR-026).

---

## `BridleChatDropZone` — new

```ts
props: {
  disabled?: boolean;   // agent is replying — releasing stages nothing
}
```

Purely presentational: a dashed-border block with an instruction, sized to roughly match the compose area it replaces so the layout does not jump. Drag events are handled by the parent (`Provider.vue`), not here — the zone must not care whether the pointer is over it or over a sibling.

When `disabled`, it renders the unavailable wording instead of the invitation (FR-008 / US2 scenario 7).

---

## `BridleChatProvider` — modified

Owns drag state for the whole chat area, because the drop target is the conversation, not just the input.

```ts
const isDraggingFile = ref(false);
const dragDepth = ref(0);
```

- `@dragenter` / `@dragover` / `@dragleave` / `@drop` bound on the chat root element.
- A drag counts as a file drag only when `e.dataTransfer?.types?.includes('Files')` (FR-009).
- `dragDepth` increments on enter and decrements on leave; `isDraggingFile` is `dragDepth > 0`. This is what stops the flicker as the pointer crosses bubbles and avatars (FR-010).
- `drop` resets depth to `0` unconditionally and hands the files to the store.
- Window-level `dragover` / `drop` listeners call `preventDefault()` while the chat is mounted, so a miss does not navigate away (FR-012). Registered in `onMounted`, removed in `onBeforeUnmount`.
- The template swaps `<BridleChatInput>` for `<BridleChatDropZone>` while `isDraggingFile` — a swap, not an overlay, per the spec. Draft text and staged files live in the store, so the swap cannot lose them (FR-013).

---

## `BridleChatMessage` — modified

```ts
props: {
  message: IBridleMessage;   // now may carry `attachments`
  agentName?: string;
}
```

Renders `<BridleChatAttachmentList>` above the text inside the bubble when attachments are present — media first, then the accompanying text, matching how every chat client orders it.

The existing user-vs-agent split is untouched: user text stays plain (`whitespace-pre-wrap`), agent text stays markdown-rendered.

---

## `BridleChatAttachmentList` — new

```ts
props: {
  attachments: IBridleAttachment[];
}
```

- `image` kinds render as bounded thumbnails (`max-h-48`, `object-cover`, rounded) in a wrapping row, opening full size on click.
- Other kinds render as a row: icon, middle-truncated name, size — the whole row an anchor to `attachment.url`.
- A thumbnail whose fetch 404s swaps to the unavailable state rather than showing a broken image (FR-024); the file row does the same on a failed open.
- Images carry `alt` text from the filename.

---

## Accessibility (FR-026)

| Element | Requirement |
|---|---|
| Paperclip button | `aria-label` from a translation key; reachable in tab order; tooltip explains the disabled reason |
| Chip remove | Real `<button>`, `aria-label` naming the file |
| Retry | Real `<button>`, `aria-label` naming the file |
| Upload progress | `role="progressbar"` with `aria-valuenow` |
| Rejections and failures | Announced through an `aria-live="polite"` region — never conveyed by color alone |
| Drop zone | Decorative for assistive tech; the paperclip is the accessible equivalent path (drag-and-drop has no keyboard analogue, which is exactly why the button is P1 and the drop zone P2) |

---

## i18n keys (English source)

Added to `app/slices/bridle/i18n/locales/en.json` under the existing `chat` namespace, then `bun run i18n:sync` generates the Russian. Never hand-write `ru.json`.

```json
{
  "chat": {
    "attach": "Attach a file",
    "attach_limit": "You can attach up to {count} files",
    "drop_hint": "Drop files here to attach",
    "drop_disabled": "Wait for the agent to finish replying",
    "attachment_remove": "Remove {name}",
    "attachment_retry": "Retry {name}",
    "attachment_uploading": "Uploading {name}…",
    "attachment_failed": "Couldn't upload {name}",
    "attachment_unavailable": "This file is no longer available",
    "attachment_not_readable": "The agent will see the name of this file, but not what's inside",
    "attachment_truncated": "This file is long — the agent will only see the first {limit} characters",
    "error_type": "{name} isn't a supported file type. Try an image, a PDF, or a text file.",
    "error_size": "{name} is larger than {limit}",
    "error_total": "Those files add up to more than {limit} in one message",
    "error_empty": "{name} is empty"
  }
}
```

Every rejection reason resolves to a key with interpolation params. Copy assembled in `<script>` travels as a key, never as text — `docs/i18n.md` is explicit that strings built in script are invisible to the extraction sweep.
