# Implementation Plan: Chat File Attachments

**Branch**: `feat/CLEAN-49-chat-file-attachments` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Jira**: [CLEAN-49](https://dreamvention.atlassian.net/browse/CLEAN-49)

**Input**: Feature specification from `specs/007-chat-file-attachments/spec.md`

## Summary

Give the customer console's agent chat a paperclip and a drop target, and carry what the person attaches all the way to the agent.

The transport is already built and unused: `SendMessageDto` accepts `parts[]` (text / image / file), the hub relays them, and the agent runtime decodes them. Everything missing is on the near side — the compose UI, the storage of the bytes, and the expansion of a stored file into the parts the agent actually reads.

The approach in one line: **the browser uploads each file to a new authenticated endpoint and keeps only an id; at send time the API expands those ids into `parts[]` server-side.** That keeps base64 out of the browser's payload and out of `localStorage`, puts text extraction (FR-020) on the server where the size limits are enforceable, and leaves the browser holding nothing heavier than an id, a name, and a size.

One finding drives the design: the agent runtime folds only image parts into the model call and discards file parts before the LLM sees them (`runtime.service.ts:192` uses `getMessageImages`; `getMessageFiles` is dead code). So "the agent received it" and "the agent can read it" are different things, and the plan closes that gap on the ranch side rather than in the runtime repository — text-like files have their contents inlined into the message text, binaries travel as a named reference and are labelled as unreadable in the UI before sending.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.2.12 (workspace runtime), Node-compatible NestJS build for the API

**Primary Dependencies**:
- API — NestJS 11, `@nestjs/platform-express` (`FileInterceptor` for multipart), `@aws-sdk/client-s3`, `class-validator` / `class-transformer`, `@nestjs/swagger`
- App — Nuxt 4 (`compatibilityVersion: 4`, `ssr: false`), Vue 3, Pinia, Tailwind 4, shadcn-vue, `lucide-vue-next` (via the slice-local `Icon` component), `@nuxtjs/i18n`, `@hey-api/openapi-ts` for the generated `#api` SDK

**Storage**: S3 (or MinIO locally) through the existing `S3Repository`, using the agent data bucket from `settings → integrations → s3_bucket`. No new database table and no Prisma migration — attachment metadata rides in the message record that already persists to `localStorage`, and the bytes are keyed under the agent's own S3 prefix.

**Testing**: API — Jest, specs colocated beside the unit under test (`chat.gateway.spec.ts`, `chatSync.service.spec.ts` are the house style); `bun run test` at the root fans out via Turbo. App — **no test runner is configured** (`"test": "echo 'app test: no tests yet'"`). The front-end half is therefore verified through `quickstart.md` rather than automated tests; standing up a Vitest harness is deliberately out of scope for this ticket.

**Target Platform**: Modern evergreen browsers (the console is a client-rendered SPA — `ssr: false`); API runs on Linux in k8s.

**Project Type**: Web application in a Turborepo monorepo — NestJS API + two Nuxt front-ends, organized as CleanSlice vertical slices (`domain` → `data` → `stores` → `components`).

**Performance Goals**: A 5 MB attachment staged and ready within 5 s on broadband (SC-003); drop zone appears within one animation frame of a file-carrying drag entering the chat (SC-004).

**Constraints**: 5 attachments per message, 10 MB per file, 25 MB per message, 100,000 characters of extracted text per file — all configurable, none hard-coded. Uploads are buffered in memory by multer (the repo cannot use `diskStorage`: under the Bun workspace, `multer` is a phantom dependency of `@nestjs/platform-express` and the import does not resolve at runtime — see the comment in `reins/source/source.controller.ts`). Attachment bytes must never be reachable at a public unauthenticated URL (FR-015).

**Scale/Scope**: One slice touched on each side (`api/src/slices/bridle`, `app/slices/bridle`); two new endpoints; roughly 4 new front-end components/refactors and 1 new store area. Admin and the embed SDK are untouched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is **the unmodified Spec Kit template** — every principle is still a `[PRINCIPLE_N_NAME]` placeholder, and the file has never been ratified. There are no project principles to check against, so this gate cannot be evaluated as written.

Rather than record a vacuous pass, the gate is evaluated against the rules this repository actually enforces, which live in `CLAUDE.md`, `.cursor/rules/project.mdc`, `docs/i18n.md`, and the CleanSlice slice conventions visible throughout the codebase:

| Rule (de facto) | Status | Notes |
|---|---|---|
| Work is tracked in Jira CLEAN, branch `{type}/CLEAN-<n>-slug`, PR into `main` | PASS | CLEAN-49, `feat/CLEAN-49-chat-file-attachments` |
| Slices stay vertical: `domain` (types + gateway interface + service) → `data` (gateway impl + mapper) → `stores` → `components`; upper layers never import downward past the interface | PASS | New code follows the existing bridle slice layering exactly; see [data-model.md](./data-model.md) |
| Generated SDK/types are regenerated, never hand-written | PASS | `generate:swagger` → `build:api` is an explicit ordered step; no hand-written DTO mirrors |
| `app` is bilingual: `en.json` is the source, `ru` is generated by `bun run i18n:sync`, copy computed in script travels as a key | PASS | FR-025; all new strings are keys, no hand-written Russian |
| `admin/` stays English-only and is not a dumping ground for app features | PASS | Admin is explicitly out of scope |
| Reuse existing infrastructure rather than introducing parallel mechanisms | PASS | `S3Repository` + `integrations/s3_bucket` reused; no new bucket, no new storage abstraction |
| Do not weaken auth | PASS — and tightens it | `JwtAuthGuard` is **not** a global guard in this API; the new routes opt in explicitly. See D3 in [research.md](./research.md) |

**Gate result: PASS**, with one recorded caveat — the constitution is unratified, so this table is the operative standard for this feature. Ratifying a real constitution is worth its own ticket and is not attempted here.

### Post-design re-check (after Phase 1)

Re-evaluated against the finished design in [research.md](./research.md), [data-model.md](./data-model.md), and `contracts/`. Still **PASS**, and the design tightened two rows rather than straining them:

- **Auth** moved from "don't weaken it" to an active improvement. D3 established that `JwtAuthGuard` is not global and that `BridleController` currently runs unguarded; the new routes opt in explicitly, and the quickstart makes an unauthenticated `401` a blocking acceptance check rather than a footnote.
- **Reuse** held under pressure. The tempting shortcut — `IFileGateway.saveRaw()`, already injected into this very controller — was rejected because its interface is string-typed and would corrupt binaries. The design falls back to `S3Repository`, which the `reins/source` slice already uses the same way. No new abstraction was introduced.

Two design choices deserve to be visible rather than buried, since both are places a reviewer might reasonably expect something else:

1. **No database table** (D5). The console's chat has no server-side message store to hang rows off; adding one would make this slice the only relational holdout and would need its own cleanup path. Metadata rides on the message; bytes live under the agent's S3 prefix and are removed by the existing `wipe(agentId)`.
2. **`text` stays `@IsNotEmpty()`** on the shared send DTO. FR-006 (send with attachments and no text) is satisfied client-side with a placeholder rather than by relaxing validation on an endpoint the embed widget and admin chat also call. Recorded in [contracts/send-message.md](./contracts/send-message.md) so it is a decision, not a surprise.

No entries for Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/007-chat-file-attachments/
├── spec.md              # Feature specification (/speckit-specify)
├── plan.md              # This file (/speckit-plan)
├── research.md          # Phase 0 — decisions D1..D11 with alternatives
├── data-model.md        # Phase 1 — entities, layering, state machine
├── quickstart.md        # Phase 1 — runnable validation guide
├── checklists/
│   └── requirements.md  # Spec quality checklist (/speckit-specify)
├── contracts/
│   ├── api-attachments.md      # HTTP contract for the two new endpoints
│   ├── send-message.md         # Additive change to the send-message contract
│   └── ui-components.md        # Props/emits contract for the touched components
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/src/slices/bridle/
├── bridle.controller.ts             # MODIFY — add upload + download routes, guarded
├── bridle.module.ts                 # MODIFY — import S3Module, register new providers
├── domain/
│   ├── bridle.types.ts              # MODIFY — attachment types + part-expansion helpers
│   ├── attachment.gateway.ts        # NEW — IBridleAttachmentGateway (abstract)
│   ├── attachment.service.ts        # NEW — validation, text extraction, parts expansion
│   ├── attachment.service.spec.ts   # NEW — unit tests (extraction, limits, expansion)
│   └── index.ts                     # MODIFY — re-export
├── data/
│   ├── attachment.gateway.ts        # NEW — S3-backed impl over S3Repository
│   ├── attachment.gateway.spec.ts   # NEW — unit tests (key derivation, round-trip)
│   └── index.ts                     # MODIFY — re-export
└── dtos/
    ├── attachment.dto.ts            # NEW — upload response + metadata DTOs
    ├── sendMessage.dto.ts           # MODIFY — additive `attachmentIds?: string[]`
    └── index.ts                     # MODIFY — re-export

app/slices/bridle/
├── domain/
│   ├── bridle.types.ts              # MODIFY — IBridleAttachment, IBridleAttachmentDraft
│   ├── bridle.gateway.ts            # MODIFY — uploadAttachment, attachmentUrl
│   └── bridle.service.ts            # MODIFY — upload use-case, send with ids
├── data/
│   ├── bridle.gateway.ts            # MODIFY — call the generated SDK
│   └── bridle.mapper.ts             # MODIFY — map upload response
├── stores/
│   └── bridle.ts                    # MODIFY — staged attachments, upload state, send
├── components/bridle/chat/
│   ├── Input.vue                    # MODIFY — paperclip, chips, paste, disabled states
│   ├── Provider.vue                 # MODIFY — drag detection, swap compose for drop zone
│   ├── Message.vue                  # MODIFY — render attachments in the bubble
│   ├── AttachmentChip.vue           # NEW — staged file chip (progress, error, remove)
│   ├── AttachmentList.vue           # NEW — sent-message attachment rendering
│   └── DropZone.vue                 # NEW — dashed-border drop target
└── i18n/locales/
    ├── en.json                      # MODIFY — source strings
    └── ru.json                      # GENERATED — `bun run i18n:sync`, never hand-edited
```

**Structure Decision**: This is the monorepo's standard web-application layout, so no new top-level structure is introduced. Work is confined to the `bridle` slice on both sides — `api/src/slices/bridle` and `app/slices/bridle` — because that slice already owns the chat transport, the send path, and the conversation store. The new API code follows the same `domain` (abstract gateway + service) / `data` (S3-backed implementation) split the `reins/source` slice uses for its own uploads, which is the closest existing precedent in the repository. No Prisma model and no migration are added; see D5 in [research.md](./research.md) for why attachment metadata does not need a table.

## Phase Sequencing

The user stories in the spec are already ordered so each is independently shippable. The build order follows them, with the API landing first because the front end cannot call an endpoint the generated SDK does not know about.

1. **API foundation** — attachment gateway, service, DTOs, two routes, unit tests. Regenerate swagger + the `#api` SDK. Verifiable with `curl` alone (see [quickstart.md](./quickstart.md)).
2. **US1 — paperclip (P1)**: store + service + `Input.vue` + `AttachmentChip.vue`. Ships a working attach-and-send on its own.
3. **US3 — transcript rendering (P2)**: `Message.vue` + `AttachmentList.vue`, plus the persisted-message shape. Split out because US1 can ship rendering a plain "1 file attached" line.
4. **US2 — drag and drop (P2)**: `DropZone.vue` + drag handling in `Provider.vue`. Pure front end, reuses every staging rule from US1.
5. **US4 — failure recovery (P3)**: per-chip error state, retry, send-blocking.
6. **Polish**: i18n sync, accessibility pass, the truncation and unreadable-file notices.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. The design adds two endpoints and one storage path, all on existing infrastructure; no new service, bucket, database table, or architectural layer is introduced.

The one judgment call worth naming — expanding attachment ids into `parts[]` on the server rather than in the browser — is recorded with its rejected alternatives as D4 in [research.md](./research.md). It removes work from the client rather than adding a layer, so it is not tracked as complexity.
