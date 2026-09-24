# Quickstart: proving CLEAN-112 end to end

Validation guide, not an implementation guide. Contracts: [files.openapi.yaml](./contracts/files.openapi.yaml), [tools.md](./contracts/tools.md), [bridle-events.md](./contracts/bridle-events.md). Entities: [data-model.md](./data-model.md).

## Prerequisites

- API running with S3 configured (settings → integrations: `s3_bucket`, `s3_endpoint` for MinIO or blank for AWS), Postgres migrated (`cd api && bunx prisma migrate deploy`).
- Admin console running; one agent (call it **B**) with a template-seeded workspace and the Rancher agent online in the Files tab's sibling chat.
- Regenerate SDKs after the API changes: `cd api && bun run generate:swagger`, then `cd admin && bun run build:api` and `cd app && bun run build:api`.
- Test data: add to B via the Files tab or the CLI `skills/run.py`, `data/config.yaml`, a 3 MB `workspace/log.txt`, a `.png`.

## Automated checks

```bash
# API — never `bun run test` (it re-runs prisma generate and kills a running dev API on Windows)
cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/file src/slices/bridle
# Admin / app pure utils
cd admin && bun test slices && npx nuxt typecheck   # revert generated SDK files afterwards
cd app && bun test slices && bun run i18n:sync --check
```

Expected: file slice specs green (archive validation, plan classification, diff caps, proposal state machine, UTF-8 slice trim, raw token, five tools), bridle specs green (proposal routing, transcript `proposals`), typecheck clean in both consoles, no missing `ru` keys.

## Scenario 1 — any text file, large files (spec US1)

1. Files tab of B → open `skills/run.py`: Monaco editor, Python highlighting, line numbers, status bar shows `Ln 1, Col 1 · Python`. Edit, `Ctrl/⌘+S` → "Saved".
2. Open `workspace/log.txt` (3 MB): first slice renders at once; scroll to the bottom repeatedly → content keeps growing, indicator "loaded 512 KB of 3.0 MB" … until "3.0 MB". Editor stays read-only ("too large to edit here — download or open full") because 3 MB > 1 MiB.
3. Press **Open full** → new tab shows the whole file as plain text; copy the URL, wait 15 min (or set `RANCH_FILES_OPEN_LINK_TTL_SEC=10`), reload → 401.
4. Open the `.png` → no editor; **Download** and **Open full** (downloads) only.
5. Open `agent.config.json`, break the JSON → badge "Invalid JSON", Save refused with "line L col C"; fix → "Valid JSON", Save works.

## Scenario 2 — import from the Files tab (US2)

1. Download B's workspace (existing Download). Create agent **C** from the same template.
2. C → Files → **Import** → pick the zip → preview shows `add / change / unchanged / skip` counts, `sessions/` rows marked skip, no `remove` (Merge). Confirm → result toast, "applies on next restart · Restart now / Later"; C's tree now equals B's plus C's own extra files.
3. Import again with **Replace** → preview shows `remove: N`; Apply asks a second time naming N; confirm → tree equals the archive exactly.
4. Craft a zip with an entry `../evil.md` → preview refused, message names the entry. Zip of 2,001 empty files → refused with the entries limit.
5. Sync guard: with C running, press **Sync** after the import → the CLEAN-50 warning lists the imported files as newer shared copies.

## Scenario 3 — the same through Rancher (US3, tools.md)

1. Rancher chat → Tools shelf → "Agent workspace" lists the five new tools with templates.
2. "List the files of agent C" → a list with kinds; "Read `agent.config.json` of C" → content.
3. Attach B's zip (< 10 MB) and say "Import this into C" → a **set** card: counts + first rows, no diffs. Say "yes" → Rancher confirms with the proposalId → card flips to Applied, result counts, restart hint.
4. Attach a 15 MB zip → the composer refuses with the attachment limit and points at the Import button.

## Scenario 4 — change card with limits (US4, bridle-events.md)

1. "Increase the heartbeat interval of C to 45 minutes" → card: `agent.config.json · line 12 · +1 −1`, inline hunk, Apply / Edit before applying / Skip. Check storage: unchanged.
2. **Apply** → card "Applied · HH:MM · applies on next restart · Restart now / Later"; the composer sends "Applied change to agent.config.json"; Rancher's next message acknowledges. Storage now has 45.
3. Open the same conversation in the **app** console → the card renders with the same state and no buttons.
4. Ask for a rewrite of `SOUL.md` into 600 lines → card shows summary `+600 −120` and **View diff in Files** (no inline hunk); the Files tab opens a side-by-side diff.
5. Ask Rancher to write a 2 MB file → card `diffStatus: too_large`, "too large to compare"; Apply still works.
6. Propose a change, then edit the same file in the Files tab and save; press **Apply** on the card → `stale`, message asks to re-propose.
7. **Edit before applying** on a fresh card → Files tab opens with the proposed content as an unsaved draft; Save → card flips to Applied (`actedVia: editor`).
8. Reload the chat → cards show their final states, none actionable except the pending one.

## Scenario 5 — explorer (US5)

1. Filter `2026-09` → only matching memory files and their folders; clear → tree expansion restored.
2. Select two files → bulk panel "2 selected · Download · Delete · Clear"; Download → one zip with exactly those; Delete → confirmation names 2, files gone.
3. Select everything → Delete → refused with the "would empty the workspace" acknowledgement.
4. Open three files, edit one → dot on its tab; switch tabs → edit kept; close it → keep/discard prompt; reload page with a dirty draft → browser warns.
5. **New file** `notes/todo.md` → appears in the tree, editable; `notes/todo.md` again → 409 "already exists"; `../x.md` → refused.
6. Running agent → header shows the neutral "Agent running since HH:MM — Sync now" pill instead of the banner (CLEAN-115: the pod pushes its own changes within ~30 s, so the pill no longer claims the pod holds newer files; Sync is the full-push safety net). After the agent made an LLM call, Sync must NOT open the "Overwrite newer files" dialog for `data/usage.json`; a file saved from the console while the agent runs still does.

## Done when

All five scenarios pass on a fresh environment, automated checks are green, the PR names which console was touched for `bridle` (both) and why the Files tab has no twin, and `docs/agent-tools.md`'s checklist is satisfied for the five tools.
