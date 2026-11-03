# Quickstart: proving CLEAN-192 end to end

Validation guide, not an implementation guide. Contracts:
[files-import.openapi.yaml](./contracts/files-import.openapi.yaml),
[tools.md](./contracts/tools.md). Entities: [data-model.md](./data-model.md).
Decisions: [research.md](./research.md).

## Prerequisites

- API running with S3 configured; one agent (**B**) seeded from a template
  that has at least two `SKILL.md` files (two skills attached) and a
  `data/memory.sqlite`; the Rancher agent online next to B's Files tab.
- Regenerate the SDK after the API changes: `cd api && bun run
  generate:swagger`, then `cd admin && bun run build:api`. The app console
  needs no regen (no files capability) but `cd app && bun run build:api`
  must still pass.
- Local copies: download B's `SOUL.md` and one `SKILL.md`; edit one line in
  each. Keep an unchanged copy of `HEARTBEAT.md`. Have any `.png` and a zip
  of B's workspace (existing Download) at hand.

## Automated checks

```bash
# API — never `bun run test` (it re-runs prisma generate and kills a running dev API on Windows)
cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/file
cd api && bun run build            # typecheck (no tsc bin)
# Admin
cd admin && bun test slices && npx nuxt typecheck   # revert regenerated SDK files afterwards
```

Expected: file slice specs green (resolve table, no-wrapper validate, ETag
guard, controller refusals, tool routing and `needs_choice`), `bun run
build` clean, admin typecheck clean.

## Scenario 1 — the switch, and the archive flow untouched (US2)

1. B → Files → **Import**. The dialog shows two tabs, **Whole workspace**
   (selected) and **Selected files**, each with one sentence; the drop zone
   says ".zip with the workspace layout".
2. Drop the `.png` → refused: "Pick a .zip … or switch to Selected files
   for plain files." Nothing uploaded.
3. Drop the workspace zip → the CLEAN-112 preview (add / change /
   unchanged / skip, Merge / Replace, double confirmation on Replace,
   result, restart hint) behaves exactly as in `specs/017…/quickstart.md`
   Scenario 2.
4. Close, reopen Import in the same tab → opens on the last mode used.
   Reload the page, reopen → **Whole workspace**.

## Scenario 2 — replace two files, add one (US1)

1. Import → **Selected files**. The drop zone says "Drop files here or
   click to choose · up to 20 files, 25 MB each".
2. Drop the edited `SOUL.md`, the unchanged `HEARTBEAT.md` and a new
   `notes.md` at once. Within a second the target table shows:
   `SOUL.md → SOUL.md`, `HEARTBEAT.md → HEARTBEAT.md`, `notes.md → notes.md
   (new, root)`. No upload yet (network tab: one `resolve` call).
3. Press **Preview** → upload with progress, then the plan: `SOUL.md
   replace`, `HEARTBEAT.md unchanged`, `notes.md add`, total size, Import
   button enabled.
4. Confirm → result "2 written, 0 skipped", the restart hint when B is
   running; the explorer shows `notes.md` at the root; opening `SOUL.md`
   shows the edited line. `HEARTBEAT.md` has the same ETag as before (check
   via the file's updated time in the explorer).
5. Open `notes.md` in the editor first, then import a different `notes.md`
   → the tab reloads with the new content (no draft) — or, with an unsaved
   draft in that tab, the draft survives and Save answers "changed since
   you opened it".

## Scenario 3 — ambiguous name, folder target, limits (US1 edge cases)

1. Select `skills/research/SKILL.md` in the explorer (open it), then Import
   → **Selected files** → drop the edited `SKILL.md`. The row shows
   **Choose…** with both `skills/research/SKILL.md` and
   `skills/writer/SKILL.md` plus "Add as new in skills/research". Preview
   is disabled until a choice is made.
2. Choose `skills/writer/SKILL.md` → Preview → `replace
   skills/writer/SKILL.md` → confirm → only that file changed.
3. Drop a file named like something under `sessions/` only → row says
   "new, <folder>"; it is never matched to the session file.
4. Drop 21 files → refused before upload, message names the limit of 20.
   Drop one 30 MB file → refused, names 25 MB.
5. Drop a single `.zip` → the dialog offers **Switch to Whole workspace**
   or **Keep as a file**; choosing the first moves the zip to the archive
   flow.
6. Drop two files both named `README.md` (from two folders) → refused as a
   duplicate name.
7. While the preview is open, change `SOUL.md` from the editor in another
   tab and save; confirm the import → result lists `SOUL.md — changed since
   previewed`, the other rows written.

## Scenario 4 — the same through Rancher (US3, tools.md)

1. In the chat next to B's Files tab, attach the edited `SOUL.md` and say
   "put this into B". The agent replies with a set card: 1 file,
   `SOUL.md change`; nothing is written (explorer unchanged). Say "yes" →
   the card turns Applied, `SOUL.md` carries the edit, the restart hint
   shows if B runs.
2. Attach the edited `SKILL.md` → the agent asks which of the two
   `SKILL.md` to replace (no card yet). Answer "the writer one" → card
   with `skills/writer/SKILL.md change` → "yes" → applied.
3. Attach `SOUL.md` and ask to "replace the whole workspace with it" → the
   agent reports that selected files never remove anything and offers the
   archive route.
4. As a non-operator user of B's own chat, ask the same → the tool is not
   offered; the agent says it cannot do that from here.

## Done when

Every scenario above passes on a local stack, the automated checks are
green with the commands named in the PR, the PR states "Files tab is
admin-only; app checked, no twin", and CLEAN-192 carries the PR link.
