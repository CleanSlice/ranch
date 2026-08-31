# Quickstart — Validating Chat File Attachments

How to prove this feature works end to end. The API half is covered by Jest; the app half has **no test runner** (`app` has none configured — see D8), so the browser steps below are the acceptance test for it. Every step names the spec requirement it proves.

---

## Prerequisites

- `make init` completed once (Bun, Docker, local Postgres, migrations).
- **S3 configured.** Settings → Integrations must have `s3_bucket` set, plus `aws_region` and either static keys or a working provider chain. Without `s3_bucket` the upload route returns a `400` naming the setting — that is the intended message, not a bug.
- **An agent that is actually running and connected.** The chat needs a live agent runtime, otherwise every send times out after 120 s and you will misread a transport failure as an attachment failure. Confirm first:

  ```bash
  curl -s http://localhost:3333/api/agent/<agentId>/health
  # expect: {"ok":true,"agentConnected":true,...}
  ```

- Sample files to hand: a PNG under 1 MB, a PDF, a `.md` file, a `.csv`, one file over 10 MB, and one unsupported type (e.g. `.zip`).

## Start

```bash
make dev          # api :3333 · app :3000 · admin :3001
```

The Makefile's inline comments say 3000/3001/3002; they are stale. `api/.env` sets `PORT=3333` and `app/.env` points `API_URL` at it.

Log into the console at `http://localhost:3000` and open an agent's chat.

---

## Part 1 — API, without a browser

Grab a token from the browser's dev tools (or the login endpoint) and export it:

```bash
TOKEN=<jwt>
AGENT=<agentId>
API=http://localhost:3333
```

### 1.1 Upload — happy path (FR-014)

```bash
curl -s -X POST "$API/api/agent/$AGENT/attachment" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./notes.md"
```

Expect `200` and a body carrying `id`, `name`, `mimeType`, `size`, `kind: "text"`, `url`, `readableByAgent: true`. Keep the `id`.

### 1.2 Auth is real (FR-015) — the most important check here

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/agent/$AGENT/attachment" -F "file=@./notes.md"
```

Expect **`401`**. A `200` or `201` here means `@UseGuards(JwtAuthGuard)` is missing — the guard is *not* global in this API (D3), so this is a genuine and easy mistake. Repeat against the download route with the id from 1.1; also expect `401`.

### 1.3 Rejections (FR-002, FR-003)

| Command | Expect |
|---|---|
| Upload the `.zip` | `400`, message names the file and the accepted kinds |
| Upload the >10 MB file | `413`, message names the limit |
| Upload a zero-byte file | `400` |

### 1.4 Download round-trip (FR-019, FR-022)

```bash
curl -s -D - -o /tmp/roundtrip.md \
  -H "Authorization: Bearer $TOKEN" \
  "$API/api/agent/$AGENT/attachment/<id>"
diff ./notes.md /tmp/roundtrip.md && echo "bytes identical"
```

Expect `200`, `Content-Type: text/markdown`, `Content-Disposition: inline`, and an identical diff. Run the same check with the **PNG** — a byte-identical binary round-trip is what proves D1 (that `IFileGateway`'s string-only interface was correctly avoided).

Then request a random UUID and expect `404` — that is the state the UI renders as "no longer available".

### 1.5 The agent actually receives it (FR-016, FR-020, FR-021)

Upload the `.md`, then send it with a question about its contents:

```bash
curl -s -X POST "$API/api/agent/$AGENT/message/sync" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"What is the second heading in the attached file?","attachmentIds":["<id>"]}'
```

The reply must quote the **actual heading from the file** (SC-010). If it answers from the filename, or says it cannot open the file, the text was not inlined — check the expansion step, not the upload.

Repeat with the CSV and the JSON. Then repeat with the **PDF** and expect the opposite: the agent should not claim to know the contents. That asymmetry is the designed behavior (D4), which is why the UI warns about it before sending.

### 1.6 Unit tests

```bash
cd api && bun run test
```

Green, including the new specs for text extraction and truncation, the validation limits, parts expansion per kind, and the "text extension, undecodable bytes" downgrade.

---

## Part 2 — Browser

### 2.1 Paperclip (US1 — FR-001, FR-005, FR-006)

1. Click the paperclip; pick the PNG and the PDF.
2. Two chips appear above the textarea — thumbnail for the image, file icon for the PDF, both with name and size.
3. The PDF's chip carries the notice that the agent will see its name but not its contents (FR-021).
4. Clear the textarea entirely. **The send button stays enabled** (FR-006).
5. Remove the PDF with its × — it goes, the PNG stays.
6. Send. The bubble shows the image; the compose area empties; the agent replies.

### 2.2 Limits in the UI (FR-002, FR-003, FR-004)

- Pick the `.zip` → rejected by name, with the accepted kinds; **any valid file picked in the same selection is still staged** (US1 scenario 4).
- Pick the >10 MB file → rejected, limit stated, nothing uploads.
- Stage 5 files → the paperclip disables and its tooltip explains the cap.
- Stage files totalling over 25 MB → rejected at the file that crosses the line, naming the total limit.

### 2.3 Drag and drop (US2 — FR-008 … FR-013)

1. Drag a file from the desktop over the chat. **The compose area is replaced** by a dashed drop zone — not covered by an overlay.
2. Move the pointer over message bubbles, the avatar, the scroll area. **No flicker** (FR-010, SC-004).
3. Drag back out without releasing → the normal compose area returns, with any draft text and staged files intact (FR-013).
4. Drag back in and release → the file stages exactly as via the paperclip.
5. Select text on another page and drag it over the chat → **no drop zone** (FR-009).
6. Drop a file on the page *outside* the chat → the page does not navigate away (FR-012).
7. While the agent is replying, drag a file over → the zone shows the unavailable wording and releasing stages nothing (FR-007).

### 2.4 Transcript and persistence (US3 — FR-019, FR-020, FR-023)

1. Send a message with the PNG and the PDF.
2. Image renders as a bounded thumbnail; clicking opens it full size. PDF renders as a named row with type and size; clicking opens it.
3. **Reload the page.** Both are still there (SC-005). Confirm `localStorage` under `bridle:conversation:<agentId>` holds only metadata — no base64 (D1/D5).
4. Attach a file with a very long name → middle-truncated, extension preserved, full name on hover.

### 2.5 Failure recovery (US4 — FR-018)

1. Stage two files, then kill the API (`Ctrl-C` on the api process) mid-upload.
2. The failing chip shows an error and a retry. **The typed draft and the other chip survive** (SC-007).
3. Press send → refused, with an explanation, rather than sending a broken message (FR-017, SC-006).
4. Restart the API, hit retry → the chip recovers and the message sends.

### 2.6 Paste and touch

- Copy a screenshot to the clipboard, focus the textarea, paste → it stages as an attachment.
- In device emulation, confirm the paperclip works and no drop zone ever appears.

---

## Part 3 — Cross-cutting

### 3.1 i18n (FR-025, SC-009)

```bash
bun run i18n:sync     # generates ru from en — never hand-write ru.json
bun run i18n:check    # must pass
```

Switch the console to Russian and walk 2.1–2.5 again. No raw key text (`chat.attach_limit`) may appear on screen — that is what a missing `en.json` entry looks like.

### 3.2 Accessibility (FR-026)

- Tab to the paperclip, open it with Enter.
- Tab to a chip's remove and retry controls and activate them by keyboard.
- With a screen reader, confirm rejections and upload failures are announced — not signalled by color alone.

### 3.3 Nothing else moved (FR-027)

- Open the **admin** debug chat: unchanged, no paperclip.
- Send a plain text message with no attachment from the console and from the embed widget: byte-identical behavior to before. The `attachmentIds` field is optional and additive; a request that omits it must take exactly the old path.

### 3.4 Typecheck

```bash
bun run typecheck     # app + admin
cd api && bun run build
```

---

## Definition of done

- [ ] `cd api && bun run test` green, including the new specs
- [ ] `bun run typecheck` green; `cd api && bun run build` green
- [ ] `bun run i18n:check` green; no untranslated keys on screen in either language
- [ ] Unauthenticated upload **and** download both return `401` (2.1.2)
- [ ] Binary round-trip byte-identical (1.4)
- [ ] Agent answers from the contents of `.md`, `.csv`, and `.json` attachments (1.5, SC-010)
- [ ] PDF is delivered but flagged as unreadable before sending (SC-011)
- [ ] Every browser step in Part 2 passes
- [ ] Admin chat and the embed path verifiably unchanged (3.3)
