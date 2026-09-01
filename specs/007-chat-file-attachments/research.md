# Phase 0 — Research: Chat File Attachments

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Jira**: CLEAN-49

All Technical Context unknowns are resolved below. Each decision records what was chosen, why, and what was rejected. Findings marked **verified** were read out of the codebase during this phase, not assumed.

---

## Prior art surveyed

| Source | What it gave us |
|---|---|
| `sdk/src/BridleChat.ce.vue` (bridle repo) | A working attach + drag-overlay implementation to learn from: `MAX_ATTACHMENTS = 5`, a `dragCounter` to stop `dragleave` flicker on nested children, per-file validation with `console.warn` skips. **Images only** (`accept="image/*"`, base64 inline). |
| `api/src/slices/reins/source/` | The house pattern for multipart upload → S3: `FileInterceptor` + an `UploadedFileLike` shape, a service that takes `{name, buffer, mimeType, size}`, a gateway with `requireBucket()` + `keyFor()` + `s3.upload()`. |
| `api/src/slices/chat/chat.controller.ts` | The house pattern for serving bytes back: `@Res()` to bypass the global `{success,data}` envelope, explicit `Content-Type` / `Content-Disposition`. |
| `api/src/slices/agent/file/` | Per-agent S3 key layout (`agents/{agentId}/…`) and the `wipe(agentId)` cleanup path. |
| `admin/slices/bridle/stores/bridle.ts` | The already-shipped `buildParts(text, images)` shape and the capability handshake (`['streaming','images','files','thinking']`). |

---

## D1 — Where attachment bytes live

**Decision**: S3 through the existing `S3Repository`, in the agent data bucket resolved from `settings → integrations → s3_bucket`, keyed `agents/{agentId}/data/attachments/{uuid}{ext}`.

**Rationale**:
- `S3Repository.upload/download` already take and return `Buffer`, handle the MinIO-vs-AWS endpoint split, `followRegionRedirects`, and the optional-credentials provider chain. Nothing needs writing.
- The `agents/{agentId}/` prefix is already wiped by `IFileGateway.wipe(agentId)` when an agent is deleted (**verified**), so the spec's retention assumption — attachments live as long as the conversation and go away with it — is satisfied without new cleanup code.
- Keeping attachments inside the agent's own prefix means access control reduces to "may this caller reach this agent", which the console already answers.

**Alternatives rejected**:
- **`IFileGateway.saveRaw()`** — the obvious reuse, and wrong. Its whole interface is string-typed (`save(agentId, path, content: string)`, `read → IFileContent { content: string }`) (**verified**). Pushing a PNG or a PDF through it would round-trip binary through UTF-8 and corrupt it. It also carries an editable-extension guard aimed at the file-editor UI.
- **A dedicated `bridle_bucket` setting** (mirroring `reins_bucket`) — a new infra setting, a new Terraform/k8s value, and a second lifecycle to reason about, all to store files that belong to an agent that already has a bucket prefix.
- **base64 in `localStorage` only** — fails FR-023 the moment anyone attaches something real: the ~5 MB origin quota is smaller than a single permitted 10 MB attachment, and the store already logs quota failures as best-effort warnings (**verified** in `saveConversationToStorage`).

---

## D2 — How the file gets back to the browser

**Decision**: an authenticated `GET /api/agent/:agentId/attachment/:attachmentId` that streams the object from S3 with its stored content type, using `@Res()` to bypass the response envelope.

**Rationale**: FR-015 forbids a publicly guessable unauthenticated address. Serving through the API keeps the bucket private, lets the guard decide, and matches three existing precedents in the repo (chat export, template export, agent file export) that all use `@Res()` plus explicit headers for exactly this reason (**verified**).

**Alternatives rejected**:
- **S3 presigned URLs** — hands the browser a URL that works for anyone who obtains it until it expires, which is the shape FR-015 rules out. It would also need `@aws-sdk/s3-request-presigner` (not currently a dependency) and bucket CORS configuration for direct browser fetches. No presign helper exists on `S3Repository` today.
- **Public bucket / public read ACL** — rejected outright by FR-015.
- **Returning base64 in the message payload** — makes every transcript replay carry megabytes and defeats D1.

---

## D3 — Authentication on the new routes

**Decision**: put `@UseGuards(JwtAuthGuard)` explicitly on both new routes.

**Rationale — this is the finding that matters most on the security side.** `JwtAuthGuard` is **not** registered as a global `APP_GUARD` in this API. `app.module.ts` imports it only to hand it to `McpModule.forRoot({ guards: [JwtAuthGuard] })` (**verified**); controllers that want it declare it themselves, as `chat.controller.ts` does with `@UseGuards(JwtAuthGuard, RolesGuard)` (**verified**).

The existing `BridleController` has **no** guard at all and resolves identity by hand — it parses the `Authorization` header, verifies the JWT itself, and falls back to a throwaway `http-<uuid>` client id for anonymous callers (**verified** in `resolveClientId`). That is deliberate: the hub also serves the embeddable widget, whose visitors are not console users.

So a new route added to this controller inherits *no* protection. Adding the guard is a conscious opt-in, not boilerplate — and omitting it would silently expose every uploaded file to the internet. Because the feature's scope is the authenticated console only (FR-027), the guard is correct here; if the embed widget is ever brought in scope, this decision must be revisited rather than copied.

**Alternatives rejected**:
- **Rely on the UUID being unguessable** — security by obscurity, and it still leaves the object readable by anyone who ever sees the URL (browser history, referrer, shared screenshot).
- **Make `JwtAuthGuard` global and mark existing bridle routes `@Public()`** — a repo-wide auth change riding in on a chat feature. Correct-looking and far too broad; it belongs in its own ticket if anyone wants it.

---

## D4 — How attachments become message parts

**Decision**: the browser uploads first and holds only ids; `SendMessageDto` gains an optional `attachmentIds?: string[]`; the **API** expands those ids into `parts[]` at send time.

Expansion rules, per attachment:
- **Image** → an `image` part with base64 read back from S3 (the shape the runtime already feeds to the model).
- **Text-like** (`text/*`, `application/json`, `text/csv`, `text/markdown`) → a `file` part **plus** its decoded contents appended to the message `text` in a fenced block labelled with the filename.
- **Anything else** → a `file` part carrying the authenticated download URL, name, and MIME type.

**Rationale**:
- Text extraction has to happen where the limits are enforced and where the bytes are already trusted — the server. Doing it in the browser would mean trusting a client-supplied "this is what the file said".
- It keeps base64 out of the request body. Client-side encoding would push a 10 MB image to roughly 13 MB of JSON on a path that is already a synchronous 120-second request.
- `localStorage` then holds an id, a name, a size and a MIME type per attachment — not bytes.
- The hub → agent wire format is untouched. `parts[]` is exactly what it was; only the HTTP request DTO gains an additive optional field, so existing callers (the embed widget, the admin chat) are unaffected.

**Alternatives rejected**:
- **Browser builds the parts** (what the SDK and admin chat do today) — sends every image's bytes twice, once to storage and once inline, and puts the 100k-character truncation rule in the least trustworthy place.
- **Skip storage for images and send base64 only** — simpler send path, but the image then cannot be re-rendered after a reload without stashing base64 in `localStorage`, which D1 already ruled out.
- **A separate "commit attachments" call before send** — a third round trip for no gain over expanding on the send the client is already making.

---

## D5 — Attachment metadata: no database table

**Decision**: no Prisma model, no migration. The metadata a message needs (`id`, `name`, `mimeType`, `size`, `kind`) is returned by the upload call, kept on the message in the store, and persisted with the conversation that already goes to `localStorage`.

**Rationale**: the console's bridle chat has no server-side message table to attach rows to — the store persists conversations to `localStorage` keyed `bridle:conversation:<agentId>`, and the durable transcript lives as JSONL in the agent's own S3 space (**verified**). Adding a table would introduce the only relational record in a slice that deliberately has none, and would need its own cleanup path to avoid outliving the S3 object.

Everything the download route needs it can derive: the agent id comes from the route, the object key from the id, and the content type from the S3 object's own `ContentType` (set at upload).

**Alternatives rejected**:
- **A `BridleAttachment` Prisma model** — real benefits (queryable, auditable, per-user ownership) but it buys nothing this spec asks for and adds a migration plus a deletion path. Revisit if attachments ever need admin-side auditing.
- **A sidecar JSON manifest object in S3** — a second object to keep consistent with the first, for metadata the message already carries.

---

## D6 — Drag-and-drop mechanics

**Decision**: detect the drag at the chat root in `Provider.vue`; **replace** the compose area with `DropZone.vue` while a file drag is active.

- Detect files, not any drag, via `e.dataTransfer?.types?.includes('Files')`.
- Track depth with an increment/decrement counter on `dragenter`/`dragleave` and treat zero as "left".
- Call `preventDefault()` on `dragover` and `drop` at the window level so a miss does not navigate the page away from the conversation (FR-012).
- Reset the counter unconditionally on `drop`.

**Rationale**: the counter is the standard fix for `dragleave` firing every time the pointer crosses a child element, and the bridle SDK already solves it exactly this way with a comment naming the flicker (**verified**) — worth copying rather than rediscovering (SC-004, FR-010).

**Alternatives rejected**:
- **A translucent overlay above the input** (what the SDK does) — the spec explicitly asks for the input to be *replaced* by a dashed block, which is the more legible pattern and what was requested.
- **`dragleave` alone with no counter** — the known-flickering approach.
- **Drop target on the whole window** — steals files from anywhere on the page, including other drop targets, and makes "left the chat" meaningless.

---

## D7 — Front-end layering

**Decision**: extend the existing bridle slice along its established seams rather than adding a parallel store.

- `domain/` — `IBridleAttachment`, `IBridleAttachmentDraft` and the upload method on the `IBridleGateway` abstract class; `BridleService` gains the upload use-case.
- `data/` — `BridleGateway.uploadAttachment()` calls the regenerated `#api` SDK through the existing `execute()` + `unwrapEnvelope()` + mapper path.
- `stores/bridle.ts` — staged drafts keyed by `agentId` (matching how `conversations`, `pending`, and `errors` are already keyed), plus upload state and a `sendMessage` that takes attachment ids.
- `components/` — auto-imported by Nuxt from the slice; `AttachmentChip`, `AttachmentList`, and `DropZone` join the existing `chat/` folder and resolve as `BridleChatAttachmentChip` etc.

**Rationale**: this is the CleanSlice layering the slice already uses (`plugins/di.ts` builds `new BridleService(new BridleGateway())` as the composition root, **verified**), and per-agent keying is the store's existing idiom. A separate attachments store would split state that a single send has to read atomically.

**Alternatives rejected**:
- **A standalone `useBridleAttachmentsStore`** — cleaner in isolation, but `sendMessage` would then need to reach across two stores and coordinate their reset.
- **Component-local state in `Input.vue`** — dies when `Provider.vue` swaps the compose area for the drop zone, which is precisely the moment the staged list must survive (FR-013).

---

## D8 — Testing strategy

**Decision**: unit-test the API half with Jest, colocated. Verify the front-end half through the runnable steps in [quickstart.md](./quickstart.md).

The API has Jest and a colocated-spec convention (`chat.gateway.spec.ts`, `chatSync.service.spec.ts`, `myChat.controller.spec.ts`) (**verified**). Worth covering, in this order:
1. Text extraction — UTF-8 decode, the 100k truncation notice, and the "text extension but undecodable bytes" downgrade to a binary reference (spec edge case).
2. Validation — per-file size, per-message total, count cap, MIME allow-list.
3. Parts expansion — image → `image` part, text-like → `file` part plus inlined text, binary → `file` part only.
4. Key derivation and the sanitizing of user-supplied filenames.

**The app has no test runner at all** — `"test": "echo 'app test: no tests yet'"` (**verified**), and no Vitest, `@vue/test-utils`, or `@nuxt/test-utils` in its dependencies. Standing one up is a real piece of work with its own configuration and CI implications; folding it into this ticket would quietly double the scope. It is called out here so the gap is a known decision rather than an oversight, and it is why `quickstart.md` is written as an explicit manual script covering every acceptance scenario the API tests cannot reach.

---

## D9 — i18n

**Decision**: add English keys to `app/slices/bridle/i18n/locales/en.json`, then run `bun run i18n:sync` to generate `ru.json`. Never hand-write Russian.

Strings needed: attach label, drop-zone prompt, per-rule rejection messages (type / size / count / total), upload progress and retry, the "agent will see the name but not the contents" notice, the truncation notice, unavailable-attachment state.

Copy that varies by state must travel as a key, not as text — `docs/i18n.md` is explicit that strings computed in `<script>` are invisible to the extraction sweep. So rejection reasons resolve to a key plus interpolation params (`{name}`, `{limit}`), never to an assembled sentence.

**Alternatives rejected**: hand-writing `ru.json` (forbidden by `CLAUDE.md`); English-only strings (the console is bilingual; `admin` is the English-only surface, and it is out of scope).

---

## D10 — Generated-SDK regeneration order

**Decision**: an ordered, non-optional step between the API and app work.

```
cd api  && bun run build && bun run generate:swagger   # → api/swagger-spec.json
cd app  && bun run build:api                           # openapi-ts → the #api SDK
```

**Rationale**: `app/slices/bridle/data/bridle.gateway.ts` calls the generated `BridleService` class from `#api`. Until the spec is regenerated, `uploadBridleAttachment` does not exist and the app cannot compile against it. `CLAUDE.md` forbids hand-writing types that OpenAPI should emit, so this ordering is load-bearing, not a convenience. `predev` and `prebuild` already run `openapi-ts` in the app, so a stale spec surfaces as a confusing missing-method error rather than a clear one.

---

## D11 — Icons

**Decision**: use the existing slice `Icon` component with lucide names — `paperclip`, `x`, `file-text`, `image`, `upload`, `alert-circle`, `rotate-cw`.

`app/slices/setup/theme/components/Icon.vue` resolves any kebab-case name against the whole `lucide-vue-next` namespace at runtime and renders nothing if the name is unknown (**verified**). No import or registration is needed per icon — but a typo fails silently to an empty element, so each name should be eyeballed once in the browser.

---

## Resolved unknowns summary

| Unknown | Resolution |
|---|---|
| Where bytes live | Agent S3 prefix via `S3Repository` — D1 |
| How bytes come back | Authenticated streaming route, `@Res()` — D2 |
| Auth model | Explicit `@UseGuards(JwtAuthGuard)`; guard is **not** global — D3 |
| Wire format to the agent | Existing `parts[]`, expanded server-side from ids — D4 |
| Persistence model | No table, no migration — D5 |
| Drag mechanics | Depth counter, `types.includes('Files')`, compose replaced — D6 |
| Front-end layering | Existing bridle slice seams — D7 |
| Test approach | Jest on the API; manual quickstart for the app (no runner exists) — D8 |
| Translations | `en.json` + `i18n:sync` — D9 |
| SDK regeneration | Swagger → `build:api`, ordered — D10 |
| Icons | Slice `Icon` component, lucide names — D11 |
