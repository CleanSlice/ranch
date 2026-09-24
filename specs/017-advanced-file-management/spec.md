# Feature Specification: Advanced Agent File Management

**Feature Branch**: `feat/CLEAN-112-advanced-file-management`

**Created**: 2026-09-23

**Status**: Draft

**Jira**: [CLEAN-112](https://dreamvention.atlassian.net/browse/CLEAN-112) `[ADMIN][APP]`

**Input**: User description: "Задача продвинутого управления файлами с агентом: расширить форматы для взаимодействия с файлами (скрипты можно добавить, но редактировать только .md и .json); большие файлы режут до превью — на каком уровне это происходит, лучше infinite scroll или кнопка «посмотреть полностью» с открытием файла из S3 в новой странице; обновить все файлы агента разом двумя флоу — кнопка Import и агентский тул, архив со структурой data/memory/skills; обновлённый дизайн страницы файлов (проводник с чекбоксами, колонками, bulk-панелью, вкладками, Monaco-редактор); в чате агент показывает diff при изменении файла с Apply / Edit / Skip и подтверждением; главное — ограничения: diff, который сломает браузер, при импорте полной системы выводить нельзя."

## Background

An agent's workspace is a set of files in shared storage under `agents/<agent-id>/`: root identity files (`SOUL.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`, `agent.config.json`) and the folders `data/`, `memory/`, `skills/`, `workspace/` (plus runtime-owned `sessions/`). The admin console shows them on the agent's **Files** tab; the running agent works on its own copy and Sync brings changes back (CLEAN-50). The app console has no Files tab.

**Where the "preview cut" happens today** (verified 2026-09-23): it is not the UI alone. The service reads a file in slices of 256 KB (512 KB maximum per request) and returns "there is more" with the next position; the viewer shows the first slice with a manual **Load more** button and disables editing while any part is still unloaded. Separately, the editor path refuses files over 1 MiB outright ("File too large to view"). So a large file is never truncated in storage, only in what the viewer has fetched so far. This spec keeps slice-based reading (it is what makes multi‑megabyte files safe to open) but removes the manual step: the viewer fills as the operator scrolls, and a **Open full** action opens the raw stored file in a new browser tab for the cases where the operator just wants to see or search all of it at once.

**What is missing today**:

- Only `.md` and `.json` can be saved; scripts and other text files a template or the agent writes (`.ts`, `.py`, `.sh`, `.yaml`, `.txt`, …) are read-only in the console even though the agent runs them.
- There is no way to replace or refresh a whole workspace. Download (zip export) exists; the reverse does not, neither as a button nor as an agent tool.
- The Ranch agent ("Rancher") has tools to delete, sync and export files but none to list, read or write them, so "change the heartbeat interval" cannot happen from the chat, and when a change does happen there is no visible diff or confirmation step.
- The explorer is a plain tree: no filter, no dates, no multi-select, one file open at a time, a bare text area.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open and edit any text file, large files included (Priority: P1)

An operator opens an agent's Files tab, selects a Python script under `skills/`, sees it with line numbers and syntax highlighting, changes one line and saves. Later they open a 3 MB transcript under `workspace/`: it starts showing immediately and keeps filling as they scroll, with no "Load more" button to press. When they want the whole thing at once (to search it in the browser, or share the address), they press **Open full** and the raw file opens in a new tab straight from storage.

**Why this priority**: The Files tab is the only place operators can see what an agent actually runs on. Read-only scripts and a manual, edit-blocking "preview" are the two most frequent complaints; fixing them delivers value even if nothing else in this spec ships.

**Independent Test**: Upload (via existing template seeding) a workspace containing `skills/run.py`, `data/config.yaml`, a 3 MB `workspace/log.txt` and a `.png`. Open each in the Files tab: the first two are editable and save; the log fills on scroll and opens full in a new tab; the image offers download/open only.

**Acceptance Scenarios**:

1. **Given** a workspace file with a recognised text format (`.md`, `.json`, `.txt`, `.yaml`/`.yml`, `.ts`, `.js`, `.py`, `.sh`, `.csv`, `.toml`, `.env`, `.html`, `.css`, `.xml` — full list in Assumptions), **When** the operator opens it, **Then** it is shown in a code editor with line numbers and format-aware highlighting, and it can be edited and saved.
2. **Given** a file whose format is not recognised as text (image, archive, PDF, unknown binary), **When** the operator selects it, **Then** the console shows its name, size and date with **Download** and **Open full** actions and no editor, and explains that it cannot be edited in place.
3. **Given** a text file larger than one read slice, **When** the operator scrolls toward the end of what is loaded, **Then** the next slice is fetched and appended automatically, a progress indicator shows "loaded X of Y", and the operator never has to press a button to continue reading.
4. **Given** a text file within the editable size limit (default 1 MiB), **When** all of it has been loaded, **Then** editing becomes available; **Given** a text file above that limit, **Then** it stays view-only with a clear note ("too large to edit here — download or open full") and the **Open full** action.
5. **Given** any file, **When** the operator presses **Open full**, **Then** a new browser tab opens showing the complete raw file from storage; the address used for this expires after a short time (default 15 minutes) and does not expose credentials.
6. **Given** a `.json` file whose edited content is not valid JSON, **When** the operator tries to save, **Then** the save is refused with the position of the first error, and the editor shows a live "Valid JSON / Invalid JSON" indicator while typing.
7. **Given** a file that the running agent has changed since it took its copy, **When** the operator saves an edit in the console, **Then** the existing "agent copy is newer — Sync" warning is still shown and the save still lands in the shared copy (the CLEAN-50 protection is untouched by the new editor).

---

### User Story 2 - Import a whole workspace from an archive (Priority: P1)

An operator has prepared an agent's files locally (or exported them from another agent) as an archive with the standard layout: root files plus `data/`, `memory/`, `skills/`, `workspace/`. On the Files tab they press **Import**, choose the archive, and before anything is written they see a summary: how many files will be added, changed, removed or skipped, with the list. They pick **Merge** (default: add and overwrite, keep everything else) or **Replace** (make the workspace identical to the archive), confirm, and the console reports the result and offers to restart the agent so it picks the files up.

**Why this priority**: "Update all agent files at once" is the second explicit request and today has no path at all. It also unlocks moving an agent between environments (export on one, import on the other).

**Independent Test**: Export agent A (existing Download), import the archive into agent B in Merge mode, verify B's file list equals A's plus B's extra files; import again in Replace mode and verify the list equals A's exactly. Verify a malformed archive is refused with a reason before any write.

**Acceptance Scenarios**:

1. **Given** a valid archive, **When** the operator selects it for import, **Then** a preview lists files to add, change, remove (Replace mode only) and skip, with counts and total size, and nothing is written until they confirm.
2. **Given** the archive wraps everything in a single top-level folder (as the existing Download export does), **When** it is previewed, **Then** that folder is treated as the workspace root and paths are shown without it.
3. **Given** an archive containing an entry with a path outside the workspace (`../`, absolute path, drive letter) or an unsupported entry type (symbolic link), **When** it is previewed, **Then** the import is refused as a whole and the offending entry is named.
4. **Given** an archive over the size limits (default 100 MB compressed, 2,000 entries, 25 MB per file), **When** it is selected, **Then** it is refused with the limit that was exceeded, before upload completes where the check is possible client-side.
5. **Given** Merge mode, **When** the import runs, **Then** files present in the archive are written, all other workspace files are left untouched, and the result states added/changed counts.
6. **Given** Replace mode, **When** the operator confirms, **Then** the confirmation names the number of files that will be removed, requires an explicit second acknowledgement, and after import the workspace contains exactly the archive's files.
7. **Given** the archive contains runtime-owned state (`sessions/`), **When** it is previewed, **Then** those entries are listed as skipped by default with an option to include them.
8. **Given** the agent is running, **When** the import completes, **Then** the console says the files apply on next restart and offers **Restart now / Later**; the "agent copy is newer" logic treats the imported files as newer shared copies so a later Sync warns before overwriting them.
9. **Given** an import fails partway (storage error), **When** the failure is reported, **Then** the message says which files were written and which were not, and the preview can be re-run to finish.

---

### User Story 3 - Ask the agent to import or change files from the chat (Priority: P2)

An operator chatting with Rancher attaches an archive (or pastes a link to one) and says "load this into the researcher agent". The agent inspects it, replies with the same add/change/remove summary the Import button would show, and asks for confirmation. On "yes", the agent imports it and reports the result, including the restart hint. Likewise, "increase the heartbeat interval to 45 minutes" makes the agent read `agent.config.json`, propose the one-line change, and apply it only after the operator confirms.

**Why this priority**: The project rule is that the console is a window and the chat is the hands: every Files-tab capability needs an agent tool. Today the agent cannot even read a file. This story makes the file capabilities reachable by language, which is the product's core promise, but it depends on Story 2's import path and Story 4's card to feel complete.

**Independent Test**: In the Rancher chat, attach a small archive and ask to import it into a named agent; verify the summary, confirm, verify the files landed. Ask for a one-field change in `agent.config.json`; verify nothing is written until the confirmation and the new value is in storage afterwards.

**Acceptance Scenarios**:

1. **Given** the operator asks the agent about an agent's files, **When** the agent answers, **Then** it can list the workspace and read any text file (respecting the same size slicing as the console) without exposing secrets.
2. **Given** the operator asks for a file change, **When** the agent has the new content ready, **Then** it presents the change for confirmation (see Story 4) and writes only after the operator confirms; a confirmation given for one change does not cover another.
3. **Given** the operator attaches an archive in the chat (within the existing chat attachment limits) or gives a link the platform can fetch, **When** they ask to import it, **Then** the agent previews it with the same rules and limits as the Import button (Merge by default, Replace only when asked and confirmed separately) and reports the result the same way.
4. **Given** the archive is larger than a chat attachment allows, **When** the operator attaches it, **Then** the attachment limit message points them to the Import button or a link.
5. **Given** a person using the agent chat who is not an operator with file access to that agent, **When** they ask for a file change or import, **Then** the tools are not offered to the agent and the agent says it cannot do that from here.

---

### User Story 4 - See and approve a file change as a card in the chat (Priority: P2)

When an agent proposes a change to a file, the conversation shows a card: the file name, the affected line, a compact before/after diff, and three actions: **Apply**, **Edit before applying**, **Skip**. Apply writes the change and the card flips to "applied"; Edit opens the file in the Files tab with the proposed content loaded but unsaved; Skip records that nothing was written. After Apply, the agent's next message says the change is saved and, if the agent is running, offers **Restart now / Later**.

**Why this priority**: Without a visible diff, "the agent changed my config" is a trust problem; with an unbounded diff, it is a browser problem. This story defines both the card and its limits, and it is the piece that needs the agent runtime and chat transport extended (a structured "file change proposal" the consoles can render, next to today's text, thinking and tool events).

**Independent Test**: Ask Rancher to change one value in `agent.config.json`: a card with a 1-line diff appears, nothing is in storage until Apply, Apply writes it. Ask for a change that rewrites a 500-line file: the card shows a summary with counts and an "open diff in Files" action instead of the inline diff. Have the agent propose a full-workspace import: the card lists files with counts and no diffs.

**Acceptance Scenarios**:

1. **Given** the agent proposes a change to one file, **When** the card renders, **Then** it shows the path, the first affected line, added/removed line counts, and an inline diff with a few lines of context, plus **Apply / Edit before applying / Skip** and an **Open in Files** link.
2. **Given** the diff for a single file exceeds the inline limit (default 200 changed lines or 100 KB of proposed content), **When** the card renders, **Then** it shows only the summary (path, +N −M, size) and a **View diff in Files** action that opens a side-by-side comparison in the Files tab, loaded on demand and itself capped (above 1 MiB of proposed content no diff is computed at all; the operator sees "too large to compare — download both").
3. **Given** the agent proposes changes to several files at once (an import, a template refresh), **When** the card renders, **Then** it shows counts (added / changed / removed) and a file list with at most a fixed number of rows expanded (default 50) and "and N more" for the rest; no per-file diff is rendered inline, each row can open its own capped diff on demand.
4. **Given** a pending card, **When** the operator presses **Apply**, **Then** the change is written exactly once, the card becomes "Applied" with a timestamp, and pressing again does nothing; **When** they press **Skip**, **Then** nothing is written and the card says so; a card can only be acted on once.
5. **Given** a pending card whose file has changed in storage since the proposal was made, **When** the operator presses **Apply**, **Then** the write is refused, the card says the file moved on, and the agent is asked to re-propose against the current content.
6. **Given** a pending card, **When** the operator presses **Edit before applying**, **Then** the Files tab opens with that file in the editor showing the proposed content as unsaved changes, so the operator can adjust and save (which counts as applying) or discard.
7. **Given** the conversation is reloaded later, **When** the history renders, **Then** applied, skipped and stale cards show their final state and are no longer actionable.
8. **Given** the app console shows the same conversation (twin `bridle` slice), **When** a card renders there, **Then** it shows the same content and state; actions are available only to a viewer who can edit that agent's files, otherwise it is read-only.

---

### User Story 5 - Work the explorer like a small IDE (Priority: P3)

The Files tab gets the explorer from the design: a filter box, a header with the storage path, file count and total size, columns for size and last modified, checkboxes with a bulk panel (**Download** selected as one archive, **Delete** selected with confirmation), tabs for the files currently open with an unsaved-changes dot, a **New file** button, and a status bar with the cursor position, format, validity and **Discard / Save** (with the keyboard shortcut). A pill in the header shows "Agent copy is newer (14:40) — Sync now" when that is the case.

**Why this priority**: These are ergonomics on top of Stories 1 and 2. Each item is small and independently shippable, and none blocks the others.

**Independent Test**: Filter the tree by "2026-09", select two memory files, download them as one archive, delete one of them with confirmation; open three files, edit one, see the dot on its tab, switch tabs without losing the edit; create `notes/todo.md` with New file and save it.

**Acceptance Scenarios**:

1. **Given** the tree, **When** the operator types in the filter, **Then** only matching paths (and their parent folders) remain visible, and clearing the filter restores the tree with the previous expansion state.
2. **Given** checkboxes on files and folders, **When** the operator selects any, **Then** a bulk panel shows the count with **Download** (one archive of the selection) and **Delete** (confirmation names the count and removes them, using the existing delete rules), and **Clear**.
3. **Given** several files opened, **When** one has unsaved changes, **Then** its tab shows a dot, switching tabs keeps the edit, closing that tab asks to keep or discard, and leaving the page with unsaved edits warns.
4. **Given** **New file**, **When** the operator enters a relative path with a text extension, **Then** an empty editable file is created there (refusing paths outside the workspace or names that already exist), and it appears in the tree.
5. **Given** the running agent took its copy before the latest shared change, **When** the header renders, **Then** it shows the "Agent copy is newer — Sync now" pill in place of the current full-width banner, with the same Sync behaviour and warning.

---

### Edge Cases

- **Text file with a non-text extension** (a script with no extension, `Makefile`): treated as text if its first slice contains no null bytes and decodes as UTF‑8; otherwise binary.
- **Non-UTF‑8 or mixed line endings**: shown as-is; saving preserves the file's line-ending style; a file that is not valid UTF‑8 is view-only with a note.
- **Slice boundary in the middle of a multi-byte character**: the viewer never displays a broken character; the split is healed when the next slice arrives.
- **File deleted or replaced while open** (by the agent, a Sync, an import or another operator): saving detects the newer version and refuses with "changed since you opened it — reload or overwrite".
- **Open full on a file that no longer exists**: the new tab shows a plain "not found", not a storage error page.
- **Open full link shared or bookmarked**: it stops working after expiry; the Files tab always mints a fresh one.
- **Import archive that is empty, not an archive, or password-protected**: refused with a plain reason.
- **Import with duplicate paths differing only by case**: refused, since storage is case-sensitive and the agent's file system may not be.
- **Import while an import is already running for the same agent**: the second is refused until the first finishes.
- **Import via chat where the link points at something that is not an archive or is unreachable**: the agent reports it; nothing is written.
- **Two pending cards for the same file**: applying one makes the other stale (scenario 4.5).
- **Card action by a user who lost file access between proposal and Apply**: refused with the reason.
- **Agent proposes a change to a binary or non-text file**: no diff; the card shows a summary and Apply replaces the file.
- **Bulk delete that would empty the whole workspace**: refused unless Replace-mode-style double confirmation is given (mirrors the existing "don't remove everything at once" Sync guard).
- **Filter that matches nothing**: an explicit empty state, tree not collapsed.

## Requirements *(mandatory)*

### Functional Requirements

**Formats and editing**

- **FR-001**: The system MUST classify each workspace file as text or binary from its extension, falling back to content sniffing for unknown extensions, and MUST show text files in an editor and binary files as download/open-only.
- **FR-002**: The system MUST allow saving any text file up to the editable size limit; the current `.md`/`.json`-only restriction is removed. The allowed set is a single configurable list shared by the console, the API and the agent tools.
- **FR-003**: The editor MUST show line numbers, format-aware highlighting for the recognised formats, cursor position, and an unsaved-changes state; it MUST support save with the platform keyboard shortcut and Discard.
- **FR-004**: The system MUST refuse to save a `.json` file that is not valid JSON, reporting the first error position, and MUST show validity live while editing.
- **FR-005**: The system MUST detect on save that the stored file changed since it was opened and refuse with a reload/overwrite choice.

**Large files**

- **FR-006**: The system MUST load text files in slices and MUST fetch the next slice automatically as the operator scrolls near the end of loaded content, showing loaded/total progress; no manual "load more" step.
- **FR-007**: Editing MUST be enabled only when the whole file is loaded and it is within the editable limit; larger files MUST be view-only with an explanation and the Open full / Download actions.
- **FR-008**: The system MUST provide **Open full**: a short-lived, credential-free address to the raw stored file that opens in a new tab and displays text inline (binary downloads). Its lifetime MUST be configurable and default to 15 minutes.
- **FR-009**: The viewer MUST never render a partial multi-byte character at a slice boundary.

**Import**

- **FR-010**: The system MUST accept a workspace archive through an **Import** action on the Files tab and MUST produce a preview (add / change / remove / skip, counts, total size, file list) before writing anything.
- **FR-011**: The import MUST support **Merge** (default: write archive files, keep the rest) and **Replace** (result equals the archive); Replace MUST state how many files will be removed and require an explicit second acknowledgement.
- **FR-012**: The import MUST refuse as a whole any archive containing path traversal, absolute paths, symbolic links, case-duplicate paths, or exceeding the size limits (default 100 MB compressed, 2,000 entries, 25 MB per file; all configurable), naming the reason.
- **FR-013**: The import MUST recognise a single wrapping top-level folder and treat it as the workspace root.
- **FR-014**: The import MUST skip runtime-owned state (`sessions/`) by default and offer to include it.
- **FR-015**: After import, the system MUST report the result, state that files apply on next restart when the agent is running, offer Restart now / Later, and mark the imported files so the Sync warning (CLEAN-50) covers them.
- **FR-016**: A failed import MUST report which files were written and which were not; re-running the preview MUST show only the remaining work.

**Agent tools (chat)**

- **FR-017**: The agent MUST have tools to list the workspace, read a text file (sliced like the console), write a file, create a file, and import an archive, each with the topic, title, template and audience gating the tools rule requires, calling the same services as the console.
- **FR-018**: Write and import tools MUST be confirm-gated: the first call returns a proposal (the card in FR-021) and writes nothing; the write happens only on a call that carries the operator's confirmation for that specific proposal.
- **FR-019**: The import tool MUST accept an archive as a chat attachment (within the existing attachment limits) or as a link the platform fetches, apply the same preview and limits as the Import button, and default to Merge.
- **FR-020**: File tools MUST be offered only to callers who can edit that agent's files, and results MUST NOT include secrets.

**Change cards**

- **FR-021**: The chat transport MUST carry a structured "file change proposal" (single file or file set) that both consoles render as a card with Apply / Edit before applying / Skip and an Open in Files link, alongside the existing text, thinking and tool events.
- **FR-022**: A single-file card MUST render the diff inline only when it is within the inline limit (default 200 changed lines and 100 KB proposed content); otherwise it MUST render a summary with counts and a **View diff in Files** action. A file-set card MUST render counts and a capped file list (default 50 rows) and never inline diffs.
- **FR-023**: The on-demand comparison in the Files tab MUST be capped: above the comparison limit (default 1 MiB proposed content) no diff is computed and the operator is offered download of both versions instead.
- **FR-024**: A card MUST be actionable exactly once; Apply MUST write once, Skip MUST write nothing, and the card MUST show its final state in history.
- **FR-025**: Apply MUST be refused when the target file changed since the proposal was made; the card MUST say so and the agent MUST be prompted to re-propose.
- **FR-026**: Edit before applying MUST open the file in the Files tab editor with the proposed content as unsaved changes.
- **FR-027**: After a successful Apply on a running agent, the conversation MUST say the change applies on next restart and offer Restart now / Later.

**Explorer**

- **FR-028**: The Files tab MUST provide a path filter, size and last-modified columns, per-row checkboxes with a bulk panel (Download selection as one archive, Delete selection with confirmation, Clear), tabs for open files with an unsaved dot, a New file action, and a compact "Agent copy is newer — Sync now" indicator with the existing Sync behaviour.
- **FR-029**: Bulk delete MUST use the existing delete rules and MUST refuse to empty the workspace without the Replace-style double acknowledgement.

**Cross-cutting**

- **FR-030**: Every limit in this spec (editable size, slice size, open-full lifetime, archive limits, inline diff, list rows, comparison cap) MUST be a named, configurable value with the stated default, not a literal scattered through the code.
- **FR-031**: The Files tab exists in the admin console only; the change card lives in the twin `bridle` slice and MUST be implemented in both consoles, with actions gated by file access.

### Key Entities

- **Workspace file**: a stored file of one agent, identified by its relative path; has size, last-modified time, a text/binary classification and, for text, an editable/view-only status derived from size.
- **File slice**: a contiguous byte range of a text file with its position, the next position, and whether more follows; the unit the viewer and the agent read in.
- **Open-full link**: a short-lived, credential-free address to one stored file; has an expiry.
- **Import bundle**: an uploaded or fetched archive plus its mode (Merge / Replace) and options (include runtime state); validated as a whole.
- **Import plan**: the preview of a bundle against the current workspace: entries classified add / change / remove / skip, with counts, sizes and refusal reasons; the same plan is what the Import button and the import tool show.
- **Change proposal**: a pending change to one file or a set of files, made by an agent: path(s), base version the proposal was computed against, proposed content or bundle, diff summary (+/− lines, size), inline diff when within limits, and a state (pending / applied / skipped / stale / refused) with who acted and when.
- **File tool set**: list, read, write, create, import, plus the existing delete, sync, export; each carrying the metadata the tools rule requires.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can open, edit and save a script or configuration file in any recognised text format; 100% of formats on the list accept a save, and a save of invalid JSON is refused every time.
- **SC-002**: A 5 MB text file can be read from top to bottom by scrolling alone, with no button press, and the page stays responsive throughout (no interaction blocked for more than a second).
- **SC-003**: Open full shows the complete raw file in a new tab within 3 seconds for files up to 25 MB, and the address stops working after its lifetime.
- **SC-004**: Importing a workspace of 200 files / 5 MB (the size of a typical agent today) shows its preview within 5 seconds and completes within 30 seconds, and every import shows a preview before the first write.
- **SC-005**: Zero writes happen from a chat proposal before the operator's Apply or confirmation; every applied change is traceable to the card that approved it.
- **SC-006**: No chat card ever renders more than the inline limit of diff lines; a proposal touching 2,000 files renders as a summary card within 2 seconds and does not slow the conversation.
- **SC-007**: Every Files-tab capability except choosing a local file has an agent tool the Tools panel lists, and the same request phrased in the chat produces the same result as the console action.
- **SC-008**: An operator refreshing an agent's whole workspace (export from one, import to another, restart) completes the task in under 5 minutes without leaving the console.

## Assumptions

- **Recognised text formats (default list)**: `.md .markdown .txt .json .jsonl .yaml .yml .toml .ini .env .csv .tsv .xml .html .css .js .mjs .cjs .ts .tsx .jsx .py .sh .bash .zsh .ps1 .sql .log`, plus extension-less files that sniff as UTF‑8 text. The list is one configurable value used by console, API and tools.
- **Editable size limit** stays at the current 1 MiB; **slice size** stays at 256 KB with the viewer prefetching when within two screens of the end. Files above the editable limit are viewable and downloadable but not editable in place.
- **Open full** is implemented as a short-lived pre-signed address to the stored object (default 15 minutes), served with a content type that makes browsers display text inline. It is minted on each click, never stored.
- **Import limits**: 100 MB compressed, 2,000 entries, 25 MB per file. A chat attachment is capped by the existing 10 MB / 5 files rule, so larger archives go through the Import button or a link.
- **Merge is the default** import mode everywhere; Replace is opt-in and double-confirmed. `sessions/` is skipped by default. Agent-owned root files (`SOUL.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`) are overwritten when the archive contains them: an explicit import is the operator's intent, unlike the template resync of CLEAN-56.
- **Change cards** ride on the existing chat transport as a new structured event type produced by the agent runtime (a separate repository); the proposal itself is held by the platform so Apply can be validated against the current stored version. The confirm-gated write tools reuse the existing `confirm` convention: first call proposes, second call with confirmation writes.
- **The Rancher chat in the admin console is the primary surface** for cards; the app console renders the same cards read-only unless the viewer can edit that agent's files.
- **Editor**: the design proposes an IDE-style editor (Monaco was suggested); the spec requires the behaviour (line numbers, highlighting, JSON validation, cursor position) and leaves the component choice to planning, with bundle size and lazy loading as review criteria.
- **Design reference**: the operator-supplied mock (explorer with filter, checkboxes, size/modified columns, bulk panel, tabs, status bar; chat card with diff and Apply / Edit / Skip; "Saved to S3 — Restart now / Later" follow-up) is the target layout; exact spacing and copy are decided in planning.
- **Out of scope**: editing binary files, live collaborative editing, version history of files, editing the running agent's own copy directly (Sync remains the bridge), and any change to what the agent runtime does with its files at boot.
