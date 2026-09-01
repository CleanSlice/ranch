---
description: "Task list for Chat File Attachments (CLEAN-49)"
---

# Tasks: Chat File Attachments

**Input**: Design documents from `specs/007-chat-file-attachments/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Jira**: [CLEAN-49](https://dreamvention.atlassian.net/browse/CLEAN-49) · **Branch**: `feat/CLEAN-49-chat-file-attachments`

**Tests**: Included for the API only. The `api` workspace has Jest with a colocated-spec convention, and D8 in research.md committed to unit-testing the validation, extraction, and expansion rules there. The `app` workspace has **no test runner configured** (`"test": "echo 'app test: no tests yet'"`), so front-end verification runs through [quickstart.md](./quickstart.md) instead. Standing up Vitest is deliberately not in this ticket.

**Organization**: Tasks are grouped by user story so each can be implemented, tested, and shipped on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task serves (US1–US4, matching spec.md numbering)
- Every task names an exact file path

## Path Conventions

Turborepo monorepo, CleanSlice vertical slices. All work lands in two slices:

- API — `api/src/slices/bridle/`
- App — `app/slices/bridle/`

Phase order runs **US1 → US3 → US2 → US4**. US2 and US3 are both P2, so their relative order is free; rendering attachments in the transcript (US3) comes first because it makes US1 demonstrable, whereas drag-and-drop (US2) only adds a second route to a staging path that already works.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The limits both sides enforce, in one place per side, and a dev environment that can actually store a file.

- [X] T001 [P] Create shared limit constants (`MAX_ATTACHMENT_BYTES`, `MAX_MESSAGE_ATTACHMENT_BYTES`, `MAX_ATTACHMENTS_PER_MESSAGE`, `MAX_EXTRACTED_TEXT_CHARS`, `ALLOWED_MIME_TYPES`) in `api/src/slices/bridle/domain/attachment.constants.ts` — values per the table in `contracts/api-attachments.md`
- [X] T002 [P] Create the mirrored client-side constants in `app/slices/bridle/domain/attachment.constants.ts` for immediate feedback, with a comment stating the server is authoritative and this copy is a convenience only
- [ ] T003 Verify local storage config: `s3_bucket`, `aws_region`, and credentials (or MinIO endpoint) are present under Settings → Integrations, and confirm the agent used for testing reports `agentConnected: true` from `GET /api/agent/<agentId>/health`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The whole API path plus the regenerated SDK. Nothing on the front end can be written until `uploadBridleAttachment` exists in `#api`.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### API — domain

- [X] T004 [P] Add `IBridleAttachment`, `BridleAttachmentKinds` enum, and the `resolveKind(mimeType, filename)` helper to `api/src/slices/bridle/domain/bridle.types.ts` per the kind table in `data-model.md`
- [X] T005 [P] Create the abstract `IBridleAttachmentGateway` (`store`, `fetch`, `head`) in `api/src/slices/bridle/domain/attachment.gateway.ts`
- [X] T006 Create `BridleAttachmentService` in `api/src/slices/bridle/domain/attachment.service.ts` with validation, UTF-8 text extraction plus truncation, and `expandToParts(agentId, ids)` — depends on T004, T005
- [X] T007 Export the new domain symbols from `api/src/slices/bridle/domain/index.ts`

### API — data

- [X] T008 Create the S3-backed `BridleAttachmentGateway` in `api/src/slices/bridle/data/attachment.gateway.ts` using `S3Repository`, resolving the bucket from `settings → integrations → s3_bucket` and keying objects `agents/{agentId}/data/attachments/{uuid}{ext}`; derive `{ext}` from the resolved MIME type, never from the supplied filename — depends on T005
- [X] T009 Export the gateway from `api/src/slices/bridle/data/index.ts`

### API — tests (write before the controller wiring)

- [X] T010 [P] Unit spec for text extraction in `api/src/slices/bridle/domain/attachment.service.spec.ts`: UTF-8 decode, truncation at `MAX_EXTRACTED_TEXT_CHARS` with the notice appended, and downgrade to `binary` when a text-extension file fails a strict decode or contains NUL bytes
- [X] T011 [P] Unit spec for validation limits in `api/src/slices/bridle/domain/attachmentValidation.spec.ts`: per-file size, per-message total, count cap, MIME allow-list, zero-byte rejection
- [X] T012 [P] Unit spec for `expandToParts` in `api/src/slices/bridle/domain/attachmentExpansion.spec.ts`: image → `image` part with base64, text-like → `file` part **plus** inlined text, binary → `file` part only, and ordering preserved
- [X] T013 [P] Unit spec for key derivation and filename sanitizing in `api/src/slices/bridle/data/attachment.gateway.spec.ts`, including a hostile filename (`../../etc/passwd`, embedded newline) never reaching the key

### API — DTOs

- [X] T014 [P] Create `BridleAttachmentDto` (id, name, mimeType, size, kind, url, readableByAgent) in `api/src/slices/bridle/dtos/attachment.dto.ts` with Swagger decorators
- [X] T015 Add the optional `attachmentIds?: string[]` field to `SendMessageDto` in `api/src/slices/bridle/dtos/sendMessage.dto.ts`, validated `@IsOptional() @IsArray() @IsUUID('4', { each: true }) @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)`
- [X] T016 Export the new DTOs from `api/src/slices/bridle/dtos/index.ts`

### API — controller and module

- [X] T017 Add `POST :agentId/attachment` to `api/src/slices/bridle/bridle.controller.ts` with `@UseGuards(JwtAuthGuard)`, `@ApiConsumes('multipart/form-data')`, and `FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } })`, `operationId: 'uploadBridleAttachment'`
- [X] T018 Add `GET :agentId/attachment/:attachmentId` to `api/src/slices/bridle/bridle.controller.ts` with `@UseGuards(JwtAuthGuard)` and `@Res()` streaming, setting `Content-Type`, `Content-Length`, `Content-Disposition: inline`, and `Cache-Control: private, max-age=3600`; return `404` for a missing object
- [X] T019 Wire `expandToParts` into both `sendMessage` and `sendMessageSync` in `api/src/slices/bridle/bridle.controller.ts` so expanded parts are **appended** to the existing `body.parts ?? buildParts(...)` base, and enforce the per-message count and total-size caps — depends on T006, T015
- [X] T020 Register `S3Module` and provide `IBridleAttachmentGateway` → `BridleAttachmentGateway` plus `BridleAttachmentService` in `api/src/slices/bridle/bridle.module.ts`

**⚠️ Guard check**: `JwtAuthGuard` is **not** a global guard in this API, and `BridleController` currently has none (it parses tokens by hand and tolerates anonymous callers so the embed widget works). T017 and T018 must declare the guard themselves — omitting it exposes every uploaded file publicly. See D3 in research.md.

### API — verify and regenerate

- [X] T021 Run `cd api && bun run test` and confirm the specs from T010–T013 pass
- [X] T022 Regenerate the OpenAPI spec: `cd api && bun run build && bun run generate:swagger`, confirming `api/swagger-spec.json` now contains `uploadBridleAttachment` and `getBridleAttachment`
- [X] T023 Regenerate the app SDK: `cd app && bun run build:api`, confirming the new methods appear on the generated `BridleService` in `#api` — depends on T022

### App — domain and data plumbing

- [X] T024 [P] Add `IBridleAttachment`, `IBridleStagedAttachment`, `BridleAttachmentKinds`, and `BridleAttachmentStates` to `app/slices/bridle/domain/bridle.types.ts`, and extend `IBridleMessage` with the optional `attachments?: IBridleAttachment[]`
- [X] T025 Add `uploadAttachment(agentId, file, onProgress)` and `attachmentUrl(agentId, id)` to the abstract `IBridleGateway` in `app/slices/bridle/domain/bridle.gateway.ts`, and change `sendMessage` to accept `attachmentIds?: string[]` — depends on T024
- [X] T026 Surface both use-cases on `BridleService` in `app/slices/bridle/domain/bridle.service.ts` — depends on T025
- [X] T027 Implement `uploadAttachment` in `app/slices/bridle/data/bridle.gateway.ts` using the regenerated SDK inside the existing `execute()` + `unwrapEnvelope()` path, and pass `attachmentIds` through `sendMessage` — depends on T023, T025
- [X] T028 Add `toAttachment(raw)` to `app/slices/bridle/data/bridle.mapper.ts`, defensively normalizing each field the way `toReply` already does

**Checkpoint**: The API works end to end and the app can call it. Verify with Parts 1.1–1.5 of quickstart.md — including the unauthenticated `401` check — before starting any UI work.

---

## Phase 3: User Story 1 — Attach a file with the paperclip button (Priority: P1) 🎯 MVP

**Goal**: A person can pick files, see them staged with names and sizes, remove any of them, and send — with or without typed text.

**Independent Test**: Open a chat with a running agent, click the paperclip, select an image and a PDF, send with "what is in these?", and confirm the message posts with both attachments and the agent replies.

### Implementation

- [X] T029 [US1] Add staged-attachment state to `app/slices/bridle/stores/bridle.ts`: `staged: Record<string, IBridleStagedAttachment[]>` keyed by `agentId`, plus the `stagedFor(agentId)` and `canSend(agentId)` selectors from data-model.md
- [X] T030 [US1] Implement `stageFiles(agentId, files)` in `app/slices/bridle/stores/bridle.ts` — validate each file against the client constants, push accepted ones as `staged`, reject the rest with a translation key, and start an upload per file. A rejected file must not block acceptable files in the same selection — depends on T029
- [X] T031 [US1] Implement `removeStaged` and `clearStaged` in `app/slices/bridle/stores/bridle.ts`, revoking each `previewUrl` object URL so previews do not leak — depends on T029
- [X] T032 [US1] Extend `sendMessage` in `app/slices/bridle/stores/bridle.ts` to pass the `ready` attachments' ids, attach their metadata to the optimistic user message, clear the staged list on success, and substitute a placeholder when the draft text is empty (the shared `SendMessageDto` keeps `text` as `@IsNotEmpty()` — see contracts/send-message.md) — depends on T030, T031
- [X] T033 [P] [US1] Create `app/slices/bridle/components/bridle/chat/AttachmentChip.vue` per contracts/ui-components.md: thumbnail or kind icon, middle-truncated name with `title`, formatted size, `uploading` / `failed` / `ready` states, a real `<button>` remove control with `aria-label`, and the FR-021 unreadable notice when `readableByAgent === false`
- [X] T034 [US1] Add the paperclip button, the hidden `<input type="file" multiple>` with `accept` from the allow-list, and the staged-chip row to `app/slices/bridle/components/bridle/chat/Input.vue`; take a new `agentId` prop and disable the control when `disabled` or the count cap is reached, with a tooltip explaining which — depends on T033
- [X] T035 [US1] Update the send-enable rule in `app/slices/bridle/components/bridle/chat/Input.vue` — enabled with trimmed text **or** at least one `ready` attachment; disabled while any attachment is `uploading` or `failed` — depends on T034
- [X] T036 [US1] Pass `agentId` into `<BridleChatInput>` from `app/slices/bridle/components/bridle/chat/Provider.vue`
- [X] T037 [P] [US1] Add the English source strings for attach, limits, and rejection reasons to `app/slices/bridle/i18n/locales/en.json` under the existing `chat` namespace, using interpolation params rather than assembled sentences

**Checkpoint**: US1 is shippable. Run quickstart 2.1 and 2.2. Attachments render in the bubble only as a plain count until US3 — that is expected.

---

## Phase 4: User Story 3 — See attachments in the conversation history (Priority: P2)

**Goal**: Sent attachments render inside the bubble — images as thumbnails, other files as named rows — and survive a reload.

**Independent Test**: Send a message with an image and a PDF, confirm the thumbnail and the named row, reload the page, and confirm both are still shown.

### Implementation

- [X] T038 [P] [US3] Create `app/slices/bridle/components/bridle/chat/AttachmentList.vue`: image kinds as bounded thumbnails (`max-h-48`, `object-cover`, rounded, `alt` from the filename) opening full size on click, other kinds as icon + middle-truncated name + size rows linking to `attachment.url`
- [X] T039 [US3] Render `<BridleChatAttachmentList>` above the text inside the bubble in `app/slices/bridle/components/bridle/chat/Message.vue` when `message.attachments` is present, leaving the existing user-plain-text / agent-markdown split untouched — depends on T038
- [X] T040 [US3] Handle the unavailable state in `app/slices/bridle/components/bridle/chat/AttachmentList.vue`: a thumbnail whose fetch 404s swaps to an explicit "no longer available" state instead of a broken image, and a file row does the same on a failed open — depends on T038
- [X] T041 [US3] Confirm persistence in `app/slices/bridle/stores/bridle.ts`: attachment metadata round-trips through `saveConversationToStorage` / `loadConversationFromStorage`, older stored conversations without the key still hydrate, and **no base64 is ever written to `localStorage`**
- [X] T042 [P] [US3] Add the English strings for the unavailable state to `app/slices/bridle/i18n/locales/en.json`

**Checkpoint**: US1 and US3 both work. Run quickstart 2.4.

---

## Phase 5: User Story 2 — Drop a file onto the conversation (Priority: P2)

**Goal**: Dragging files over the chat replaces the compose area with a dashed drop zone; releasing stages them exactly as the paperclip does.

**Independent Test**: Drag an image over the chat area, confirm the compose area becomes a dashed drop zone, release, and confirm the file stages identically to a paperclip selection.

### Implementation

- [X] T043 [P] [US2] Create `app/slices/bridle/components/bridle/chat/DropZone.vue` — a presentational dashed-border block sized to roughly match the compose area it replaces, with a `disabled` prop that swaps the invitation for the unavailable wording. It handles no drag events itself
- [X] T044 [US2] Add drag state (`isDraggingFile`, `dragDepth`) and the `dragenter` / `dragover` / `dragleave` / `drop` handlers on the chat root in `app/slices/bridle/components/bridle/chat/Provider.vue`, treating a drag as a file drag only when `e.dataTransfer?.types?.includes('Files')`, and using the depth counter so crossing nested children does not flicker
- [X] T045 [US2] Swap `<BridleChatInput>` for `<BridleChatDropZone>` while `isDraggingFile` in `app/slices/bridle/components/bridle/chat/Provider.vue` — a replacement, not an overlay. Draft text and staged files live in the store, so the swap must not lose them — depends on T043, T044
- [X] T046 [US2] Route dropped files into `stageFiles` from `app/slices/bridle/components/bridle/chat/Provider.vue`, resetting `dragDepth` to `0` unconditionally on drop, and stage nothing while the compose area is disabled — depends on T044
- [X] T047 [US2] Register window-level `dragover` and `drop` listeners that `preventDefault()` in `app/slices/bridle/components/bridle/chat/Provider.vue`, added in `onMounted` and removed in `onBeforeUnmount`, so a missed drop does not navigate the page away from the conversation
- [X] T048 [P] [US2] Add a clipboard `@paste` handler to `app/slices/bridle/components/bridle/chat/Input.vue` that stages image items from the clipboard through the same `stageFiles` path
- [X] T049 [P] [US2] Add the English strings for the drop-zone prompt and its disabled wording to `app/slices/bridle/i18n/locales/en.json`

**Checkpoint**: US1, US2, and US3 all work. Run quickstart 2.3 and 2.6.

---

## Phase 6: User Story 4 — Recover from a failed attachment (Priority: P3)

**Goal**: A failed upload is reported against that file, retryable, and never costs the person their typed message or their other attachments.

**Independent Test**: Stage two files, force one to fail, and confirm the per-file error with a retry, the other file still staged, and the typed text preserved.

### Implementation

- [X] T050 [US4] Add `retryStaged(agentId, localId)` to `app/slices/bridle/stores/bridle.ts`, moving the chip from `failed` back to `uploading` and re-running the upload without touching the draft or the other staged files
- [X] T051 [US4] Set per-file `error` (as a translation key) and `state: 'failed'` on upload rejection in `app/slices/bridle/stores/bridle.ts`, ensuring one failure never clears the draft or other attachments — depends on T050
- [X] T052 [US4] Render the error state and the retry control in `app/slices/bridle/components/bridle/chat/AttachmentChip.vue`, with a real `<button>` and an `aria-label` naming the file — depends on T050
- [X] T053 [US4] Block sending in `app/slices/bridle/stores/bridle.ts` while any attachment is `uploading` (wait for it to settle, with a visible in-progress indication) or `failed` (refuse with an explanation until it is retried or removed) — depends on T051
- [X] T054 [P] [US4] Add the English strings for upload progress, failure, and retry to `app/slices/bridle/i18n/locales/en.json`

**Checkpoint**: All four stories are independently functional. Run quickstart 2.5.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T055 Generate the Russian translations: `bun run i18n:sync`, then `bun run i18n:check`. Commit both locale files. Never hand-write `ru.json`
- [ ] T056 Walk the console in Russian through quickstart 3.1 and confirm no raw key text (e.g. `chat.attach_limit`) reaches the screen
- [X] T057 [P] Add the `aria-live="polite"` announcement region for rejections and upload failures in `app/slices/bridle/components/bridle/chat/Input.vue`, so no failure is signalled by color alone
- [X] T058 [P] Add `role="progressbar"` with `aria-valuenow` to the upload indicator in `app/slices/bridle/components/bridle/chat/AttachmentChip.vue`
- [ ] T059 Keyboard pass per quickstart 3.2 — tab to the paperclip and open it with Enter, tab to each chip's remove and retry controls and activate them by keyboard
- [X] T060 Verify every lucide icon name used resolves: `paperclip`, `x`, `file-text`, `image`, `upload`, `alert-circle`, `rotate-cw`. The slice `Icon` component renders **nothing** for an unknown name, so a typo fails silently
- [ ] T061 Confirm nothing else moved, per quickstart 3.3: the admin debug chat is unchanged, and a plain text send with no `attachmentIds` takes byte-identically the old path
- [X] T062 Run `bun run typecheck` and `cd api && bun run build`; fix any fallout
- [ ] T063 Run the full quickstart.md definition-of-done checklist end to end
- [ ] T064 Update `README.md` or `docs/` only if the attachment limits need documenting for operators; skip if the settings are self-explanatory

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**. The SDK regeneration (T022, T023) is the hard gate: no front-end task can compile before it
- **User Stories (Phases 3–6)**: all depend on Phase 2
- **Polish (Phase 7)**: depends on the stories being complete

### User Story Dependencies

- **US1 (P1)**: depends only on Phase 2. Ships alone
- **US3 (P2)**: independent of US1 in principle, but only observable once something has been sent with an attachment — pair with US1 in practice
- **US2 (P2)**: depends on `stageFiles` from US1 (T030). It is a second route into the same staging path, not a parallel implementation
- **US4 (P3)**: depends on the staged-state machine from US1 (T029–T031)

### Within Each Story

- Store state before store actions before components
- Presentational components (`AttachmentChip`, `DropZone`, `AttachmentList`) before the containers that mount them
- English strings can land in parallel with the components that use them; `i18n:sync` runs once at the end

### Parallel Opportunities

- T001 and T002 (Setup)
- T004 and T005 (independent domain files)
- T010–T013 (four spec files, no shared state)
- T014 and T024 (API DTO and app types)
- T033 (`AttachmentChip`), T038 (`AttachmentList`), T043 (`DropZone`) — three separate new components, and the biggest parallel win in the plan
- T037, T042, T049, T054 — all locale additions, though they touch the same `en.json`, so land them as one edit if working solo
- T057 and T058 (different files)

---

## Parallel Example: Phase 2 API specs

```bash
# Four independent spec files, no shared fixtures:
Task: "Text extraction spec in api/src/slices/bridle/domain/attachment.service.spec.ts"
Task: "Validation limits spec in api/src/slices/bridle/domain/attachmentValidation.spec.ts"
Task: "Parts expansion spec in api/src/slices/bridle/domain/attachmentExpansion.spec.ts"
Task: "Key derivation spec in api/src/slices/bridle/data/attachment.gateway.spec.ts"
```

## Parallel Example: presentational components

```bash
# Three new components with no imports of each other:
Task: "AttachmentChip.vue in app/slices/bridle/components/bridle/chat/"
Task: "AttachmentList.vue in app/slices/bridle/components/bridle/chat/"
Task: "DropZone.vue in app/slices/bridle/components/bridle/chat/"
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 — Setup
2. Phase 2 — Foundational, ending with the SDK regeneration
3. Phase 3 — US1
4. **Stop and validate**: quickstart Part 1 and 2.1–2.2
5. Demoable: a person can attach files and the agent answers about their contents

### Incremental delivery

1. Setup + Foundational → the API is provably correct on its own, `curl`-testable
2. + US1 → attach and send works (**MVP**)
3. + US3 → the transcript shows what was sent, and survives a reload
4. + US2 → drag-and-drop
5. + US4 → failure recovery
6. + Polish → Russian, accessibility, final sweep

### Solo-developer note

Phases 3–6 all touch `stores/bridle.ts` and `Input.vue`, so parallelising them across people would mean constant conflicts in two files. Working solo, the sequence above is the right one. With a second pair of hands, the clean split is **API (Phase 2) / front end**, not story-by-story.

---

## Notes

- The single riskiest task is **T017/T018's guard**. `JwtAuthGuard` is not global here and `BridleController` deliberately runs unguarded for the embed widget, so a route added without `@UseGuards` is public. Quickstart 1.2 makes the `401` a blocking check
- The second riskiest is **T023**. Skipping the SDK regeneration produces a confusing "method does not exist" error in the app rather than a clear one
- `[P]` means different files and no dependency on incomplete work
- Commit per task or per logical group, with `CLEAN-49` in the subject
- Stop at any checkpoint to validate a story on its own

---

## Implementation status — 2026-09-01

**58 of 64 tasks complete.** Every code task landed. Both halves now verify by
tooling; what is left needs a running stack.

**Verified here**

- `cd api && npx jest src/slices/bridle` — 27 tests, all passing
- `cd api && bun run build` — clean (run `bun run generate` first: `bun install` wipes the generated Prisma client, and without it 51 unrelated files fail to resolve `@prisma/client`)
- `bun run typecheck` — app and admin both clean. Confirmed the check is real, not a no-op: a deliberate type error planted in `AttachmentChip.vue` was caught (`TS2322`) and then removed
- `bun run i18n:sync` — all 15 Russian keys generated; `bun run i18n:check` reports 6 slice/locale pairs in sync, 190 keys, **no component using a key no locale defines**
- Every lucide name used by the slice resolves through the `Icon` component's PascalCase mapping — checked against the installed `lucide-vue-next` for all 13: `paperclip`, `x`, `file-text`, `image`, `file`, `upload`, `alert-circle`, `alert-triangle`, `rotate-cw`, `image-off`, `ban`, `loader-2`, `send`
- Swagger regenerated: both attachment routes present, `attachmentIds` on `SendMessageDto`. App and admin SDKs regenerated, additions only (163 lines, 3 files each)

**Still open, and why**

| Task | Blocked on |
|---|---|
| T003 | The local stack is not running (`make dev`), so S3 settings and agent health can't be checked |
| T056 | The static half is closed — every key the components use exists in `ru.json`, so no raw key name can reach the screen. What remains is the visual pass: Russian is longer than English and the chips are narrow |
| T059, T061, T063 | Manual passes that need the app running |
| T064 | Judgement call, deferred until the limits are confirmed in a real environment |

**Note on the i18n key**: `CLAUDE_API_KEY` was never the problem. It is an
identity-linked key, and the API answers those with a 400 naming
`anthropic-workspace-id` rather than a 401 — so the failure read like a bad key.
`scripts/i18n-sync.ts` now takes `CLAUDE_WORKSPACE_ID` from `.env.project` and
sends it as a header.

**First thing to do next**: bring the stack up and walk `quickstart.md` end to end.
