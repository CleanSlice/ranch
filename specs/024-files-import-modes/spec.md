# Feature Specification: Files Import — Whole Workspace or Selected Files

**Feature Branch**: `feat/CLEAN-192-files-import-modes`

**Created**: 2026-10-29

**Status**: Draft

**Ticket**: [CLEAN-192](https://dreamvention.atlassian.net/browse/CLEAN-192)

**Input**: User description: "У нас в файлах есть импорт workspace. Но я бы разделил импорт всего агента от отдельных файлов. Стоит добавить переключение мы импортируем workspace (всего агента) или отдельные два-три файла, уже не архивом, если по имени находит, то их заменяет. нужно расширить" (with a screenshot of the current **Import workspace** dialog: a single drop zone for a .zip with the workspace layout).

## Context

The agent's **Files** tab in the admin console has one **Import** action, built in CLEAN-112 (spec `017-advanced-file-management`, User Story 2). It accepts a zip with the workspace layout (root files plus `data/`, `memory/`, `skills/`, `workspace/`), previews every add / change / remove before anything is written, offers Merge or Replace, and reminds the operator that a running agent picks the files up on restart. The Ranch agent has a matching chat tool for the same archive import.

That flow solves "move or refresh a whole agent". It does not fit the everyday case: an operator downloaded `SOUL.md` or a skill file, edited it locally, and wants to put two or three files back. Today they have to build an archive with the right folder layout first, and the dialog's copy ("a zip with the workspace layout") tells them plain files are not welcome.

This feature splits the import into two explicit modes and adds the second one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Replace or add a few files without building an archive (Priority: P1)

An operator opens **Import** on the Files tab, switches to **Selected files**, and drops two or three plain files (or picks them in the file chooser). Before anything is written they see one row per file: the file's name, where it will land in the workspace, and whether it **replaces** an existing file, is **added** as a new one, or is **unchanged** because the content is identical. They confirm, the files are written, and the console reports the result with the same restart hint the workspace import gives.

A dropped file whose name matches exactly one existing workspace file replaces that file, wherever it lives (`SOUL.md` at the root, `memory.sqlite` under `data/`). A file whose name matches nothing is added to the folder the operator had selected in the explorer when they opened the dialog (the workspace root when nothing was selected). A file whose name matches several workspace files (several `SKILL.md`, several `README.md`) is not guessed: the preview row asks the operator to pick which one to replace, or to add it as a new file in the target folder.

**Why this priority**: This is the request. "Update two or three files" is the most frequent edit an operator makes after a download, and it currently has no direct path.

**Independent Test**: Download `SOUL.md`, change one line, import it through **Selected files**: the preview shows one row, "replaces SOUL.md", the file in storage carries the change afterwards, and no other file changed. Import a file with a new name: it appears in the selected folder. Import a file named like two existing files: the preview demands a choice and writes nothing until it is made.

**Acceptance Scenarios**:

1. **Given** the Import dialog is open, **When** the operator looks at it, **Then** a visible switch offers **Whole workspace** and **Selected files**, each with one sentence saying what it takes, and the drop zone copy changes with the mode.
2. **Given** **Selected files** mode, **When** the operator drops or picks one or more plain files, **Then** the preview lists each file with its target path and action (replace / add / unchanged) and the total size, and nothing is written until they confirm.
3. **Given** a dropped file whose name matches exactly one workspace file, **When** the preview is built, **Then** the row shows that file's full workspace path and the action **replace**.
4. **Given** a dropped file whose name matches no workspace file, **When** the preview is built, **Then** the row shows the action **add** and a target path inside the folder selected in the explorer (root by default).
5. **Given** a dropped file whose name matches several workspace files, **When** the preview is built, **Then** the row shows the candidate paths and the operator must choose one of them or "add as new" before the confirm button becomes available.
6. **Given** a dropped file identical to the matched workspace file, **When** the preview is built, **Then** the row says **unchanged** and the confirm button stays disabled when every row is unchanged.
7. **Given** the operator confirms, **When** the files are written, **Then** the result states how many were written and how many were skipped, names any file that could not be written with the reason, and the Files tab shows the new content without a manual reload (an open editor tab for a replaced file is reloaded or marked as changed).
8. **Given** the agent is running, **When** the import completes, **Then** the console says the files apply on the next restart and offers **Restart now / Later**, exactly as the workspace import does.
9. **Given** a file larger than the per-file import limit, or more files than the selected-files limit, **When** they are dropped, **Then** the dialog refuses with a plain message naming the limit and writes nothing.
10. **Given** a dropped file whose only existing match lives in the runtime-owned `sessions/` area, **When** the preview is built, **Then** it is treated as no match (added to the target folder), because selected-files import never touches runtime state.

---

### User Story 2 - The whole-workspace import stays exactly as it is (Priority: P1)

An operator who wants to move or refresh an entire agent switches to (or stays on) **Whole workspace**, drops the zip, and gets the flow they have today: upload once, preview add / change / remove / skip, Merge or Replace, the double confirmation for removals, the result and the restart hint.

**Why this priority**: The split must not cost the existing capability anything. It is P1 because a regression here breaks the only way to move an agent between environments.

**Independent Test**: Run the CLEAN-112 independent test unchanged (export agent A, import into B in Merge, then in Replace) through the **Whole workspace** mode and get the same results and messages.

**Acceptance Scenarios**:

1. **Given** the Import dialog opens, **When** no mode was chosen earlier in this console session, **Then** it opens on **Whole workspace**, so the current habit still works.
2. **Given** **Whole workspace** mode, **When** the operator drops a .zip, **Then** the existing stage → preview → Merge/Replace → confirm → result flow runs with the same limits and copy as before.
3. **Given** **Whole workspace** mode, **When** the operator drops anything that is not a .zip, **Then** the dialog refuses it and points to **Selected files** for plain files.
4. **Given** **Selected files** mode, **When** the operator drops a single .zip and nothing else, **Then** the dialog does not unpack it silently: it offers to switch to **Whole workspace**, or to keep the zip as an ordinary file if that is what they meant.
5. **Given** the operator chose a mode, **When** they open the dialog again in the same console session, **Then** it opens on that mode.

---

### User Story 3 - Hand the agent a few files from the chat (Priority: P2)

An operator chatting with Rancher attaches one or more plain files (not a zip) and says "put these into the researcher agent". The agent previews them with the same name-matching rules and the same per-row add / replace / unchanged outcome, asks for confirmation, writes them on "yes", and reports the result with the restart hint. Ambiguous names are reported as a question ("which `SKILL.md`?") rather than guessed.

**Why this priority**: The project rule is that the console is a window and the chat is the hands: a Files-tab capability is not finished until the agent can do it too. It is P2 because the console flow stands on its own and the agent already has a write-one-file tool for path-explicit changes; this story extends the existing import tool to plain attachments so the chat and the dialog behave the same.

**Independent Test**: In the Rancher chat, attach an edited `HEARTBEAT.md`, ask to import it into a named agent, verify the proposal names the target path and the action, confirm, verify the content landed. Attach a file whose name exists twice; verify the agent asks which one instead of writing.

**Acceptance Scenarios**:

1. **Given** the operator attaches one or more plain files within the chat attachment limits, **When** they ask the agent to import them into an agent, **Then** the agent produces the same preview (target path, action per file, total size) as the dialog would and writes nothing before confirmation.
2. **Given** a name that matches several workspace files, **When** the agent previews, **Then** it lists the candidates and asks the operator to choose; a later call with the choice proceeds.
3. **Given** a person using the agent chat who is not an operator with file access to that agent, **When** they ask for it, **Then** the tool is not offered and the agent says it cannot do that from here (unchanged from CLEAN-112).

---

### Edge Cases

- **Two dropped files with the same name** in one selected-files import: refused with a message naming the duplicate; the operator drops them in two rounds.
- **Name differing only by case** (`Soul.md` dropped, `SOUL.md` exists): no match, treated as **add**; the preview makes the new path visible so the operator can cancel. Storage is case-sensitive and the agent's file system may not be, so no guessing.
- **Folder dropped** in selected-files mode: refused with a hint to zip it and use **Whole workspace**; the feature does not walk folders.
- **File name the workspace cannot hold** (path separators, control characters, reserved names): refused with the reason.
- **Target folder no longer exists** (its last file was deleted in another tab between selecting it and confirming): the chosen path is kept and the folder reappears with the added file, because folders are implied by file paths; the preview shows the full path either way.
- **Workspace file changed between preview and confirm** (by the agent, a Sync, another operator): the write for that row is refused as "changed since previewed", the others proceed, and the result lists it; re-running the preview shows the new state.
- **Selected file replaces a file the operator has open in the editor with unsaved changes**: the tab is marked as changed on disk and the operator's unsaved text is not lost silently (same rule as a file replaced by Sync today).
- **Import while another import for the same agent is running**: the second is refused until the first finishes (unchanged from CLEAN-112).
- **Empty file dropped**: allowed; it replaces or adds an empty file and the preview shows size 0.
- **Agent-owned root files** (`SOUL.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`): replaced when dropped, since an explicit import is the operator's intent (same rule as the archive import).

## Requirements *(mandatory)*

### Functional Requirements

**Mode switch**

- **FR-001**: The Import dialog MUST offer two modes, **Whole workspace** and **Selected files**, as a visible switch with a one-sentence explanation of each; the mode MUST be changeable before any file is chosen.
- **FR-002**: The dialog MUST open on **Whole workspace** the first time in a console session and on the last chosen mode afterwards, within that session.
- **FR-003**: In **Whole workspace** mode a non-zip drop MUST be refused with a pointer to **Selected files**; in **Selected files** mode a lone .zip MUST trigger an offer to switch modes rather than being unpacked or silently stored.

**Whole workspace (unchanged)**

- **FR-004**: **Whole workspace** mode MUST keep the CLEAN-112 behaviour and limits unchanged: stage once, preview add / change / remove / skip with counts and total size, Merge by default, Replace with the double confirmation for removals, result, restart hint, Sync marking.

**Selected files**

- **FR-005**: **Selected files** mode MUST accept one or more plain files by drop or file chooser, up to a configurable count (default 20) and the existing per-file import size limit; over the limit it MUST refuse before anything is uploaded and name the limit.
- **FR-006**: For each selected file the system MUST produce a preview row before writing: the file name, the target workspace path, the action (**replace**, **add**, **unchanged**) and the size; nothing MUST be written until the operator confirms.
- **FR-007**: Matching MUST be by exact file name, case-sensitive, across the whole workspace except runtime-owned `sessions/`: exactly one match → **replace** at that path; no match → **add** in the operator's target folder; several matches → the row MUST require the operator to choose a candidate or "add as new" before the import can be confirmed.
- **FR-008**: The target folder for **add** MUST default to the folder selected in the explorer when the dialog was opened, and to the workspace root when none was selected; the preview MUST show the resulting path.
- **FR-009**: A selected file whose content is identical to its match MUST be shown as **unchanged** and MUST NOT be rewritten; an import where every row is unchanged MUST not be confirmable.
- **FR-010**: Selected-files import MUST never remove a workspace file and MUST NOT offer a Replace-the-workspace option.
- **FR-011**: The same file-name validation and kind rules that apply to archive entries MUST apply to selected files (any kind the workspace accepts, not only editable text); a refused file MUST be named with the reason, and the refusal MUST not block the other files unless the operator cancels.
- **FR-012**: After writing, the system MUST report written / skipped counts, list failures with reasons, refresh the Files tab, mark the written files for the Sync warning, and show the restart hint with **Restart now / Later** when the agent is running, exactly as the archive import does.
- **FR-013**: A write for a row whose workspace file changed between preview and confirm MUST be refused for that row only ("changed since previewed"), and the result MUST say so.

**Chat tool**

- **FR-014**: The agent's import tool MUST accept one or more plain-file chat attachments (within the existing attachment limits) in addition to a zip, apply the same matching rules and preview as the dialog, write nothing before the operator's confirmation, ask when a name is ambiguous, and report the result the same way, with the same audience gating as today.

### Key Entities

- **Import mode**: the operator's choice between *Whole workspace* (one archive, may replace the entire workspace) and *Selected files* (a handful of plain files, never removes anything). Remembered for the console session.
- **Selected-files plan**: the preview of a set of plain files against the current workspace: one row per file with name, target path, action (replace / add / unchanged), size, and, for ambiguous names, the candidate paths and the operator's choice. The same plan is what the dialog and the chat tool show.
- **Target folder**: the explorer folder (or root) that receives files with no match.
- **Selected-files result**: written / skipped counts, per-file failures with reasons, and whether a restart is needed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can replace one downloaded-and-edited workspace file from the Files tab in under 1 minute and at most 4 interactions (open Import, switch mode, drop, confirm), without creating an archive.
- **SC-002**: 100% of selected-files imports show a per-file preview before the first write, and a name that matches several files is never written without an explicit choice.
- **SC-003**: A selected-files import of 3 files totalling 1 MB shows its preview within 3 seconds and completes within 10 seconds.
- **SC-004**: The whole-workspace flow passes the CLEAN-112 acceptance scenarios unchanged after the split (same counts, same confirmations, same messages).
- **SC-005**: Asking the agent in chat to import an attached plain file yields the same target path and action as the dialog would for the same file, in 100% of a labelled set of at least 10 cases covering unique match, no match and ambiguous match.

## Assumptions

- **Surface**: the Files tab, and therefore this feature, exists only in the admin console; the app console has no files capability, so the twin-console check needs nothing there. The server-side changes are shared by the dialog and the agent tool.
- **"By name" means exact file name, anywhere in the workspace** (except `sessions/`), not a full path. The operator drops `SOUL.md`, not `/SOUL.md`; the system finds where it lives. Ambiguity is resolved by the operator, never by position or recency. If a path-aware drop is wanted later (dropping a folder and keeping its structure), that is a separate feature.
- **Selected-files limit of 20 files** per import is a default chosen to keep the preview readable in one screen; the user's own words were "two or three". It is configurable like every other file limit, and anything larger belongs to the archive flow.
- **Per-file size and kind rules** are the archive-entry rules from CLEAN-112 (default 25 MB per file, any kind the workspace stores), not the editor's 1 MB text-only rule, because the point is to put back files such as `memory.sqlite` as well as `SOUL.md`.
- **Mode memory is per console session**, not a stored preference, so a new session always starts on the familiar whole-workspace mode.
- **No new Replace semantics**: selected files never delete; the only destructive action remains the archive import's Replace with its existing double confirmation.
- **Restart and Sync behaviour** are reused as-is from CLEAN-112 (FR-015 there).
- **Chat attachments** keep their existing limits (10 MB / 5 files); larger or more files go through the dialog.
- **Dependencies**: the stage / preview / apply flow, file limits, Sync marking, restart hint and the import agent tool from CLEAN-112 (`specs/017-advanced-file-management`).
