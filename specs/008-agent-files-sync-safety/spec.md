# Feature Specification: Agent Files — Visible Copy Model & Safe Sync

**Feature Branch**: `feat/CLEAN-50-agent-files-sync-safety`

**Created**: 2026-08-31

**Status**: Draft

**Jira**: [CLEAN-50](https://dreamvention.atlassian.net/browse/CLEAN-50) `[ADMIN]`

**Input**: User description: "Возьми в работу CLEAN-50, а так же убедись — что именно пушит рантайм при Sync (все файлы или дельту)"

## Background

An agent's files exist as two copies: a shared copy (shown in the admin Files tab) and the running agent's own working copy (taken from the shared copy when the agent boots, sent back only when an operator triggers Sync). A Mazda dev-installation user edited SOUL.md through the admin agent and could not tell why the Files tab did not reflect the change — the model is technically correct but invisible to the operator.

**Verified Sync behavior** (research, 2026-08-31): Sync sends back only a *delta*, not all files — the running agent tracks each file's local modification time and size from the moment it booted, and sends only files that changed locally since then. It also *removes* shared files that were deleted in the working copy (with an existing safeguard against removing everything at once). Crucially, it never checks whether the shared copy changed in the meantime. Consequences:

- A file edited **only** in the shared copy (UI editor or admin-agent write) is left untouched by Sync — the "skip unchanged" rule protects it.
- A file edited **both** in the shared copy and in the agent's working copy (the SOUL.md case) is silently overwritten by the agent's version.
- A file deleted in the working copy is removed from the shared copy even if it was just updated there.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync warns before destroying newer shared edits (Priority: P1)

An operator edits an agent file in the shared copy (via the UI editor or through the admin agent) while the agent is running. Later they press Sync. Instead of silently losing the edit, they see a warning listing the files whose shared copy is newer than what the running agent last took, including files Sync would remove, and must explicitly confirm before those files are overwritten or deleted.

**Why this priority**: This is active data loss — "my edit disappeared" — and the direct cause of the user report. Everything else is visibility polish around this hazard.

**Independent Test**: Edit a file in the Files tab while the agent is running and has also modified the same file, press Sync, observe the warning naming that file; confirm → file overwritten; cancel → shared edit intact.

**Acceptance Scenarios**:

1. **Given** a running agent whose working copy of a file changed AND whose shared copy was edited after the agent last took/sent files, **When** the operator triggers Sync, **Then** a warning lists that file as "will be overwritten, shared copy is newer" and Sync proceeds only after explicit confirmation.
2. **Given** a file deleted in the agent's working copy whose shared copy was edited after the agent last took/sent files, **When** the operator triggers Sync, **Then** the warning lists that file as "will be removed" and requires the same confirmation.
3. **Given** no conflicts (no shared-copy object newer than the agent's last take/send), **When** the operator triggers Sync, **Then** Sync runs immediately without an extra confirmation step.
4. **Given** a file edited only in the shared copy (agent's working copy untouched), **When** Sync runs, **Then** the file is not listed as a conflict and is not overwritten (existing delta behavior, must be preserved).

---

### User Story 2 - The two-copy model is visible in the Files tab (Priority: P2)

An operator opening the Files tab of a running agent can tell which copy they are looking at and that the running agent may hold newer content that will only appear after Sync. After a chat-driven change (agent wrote to its own files), the operator understands Sync is required to see it.

**Why this priority**: Removes the confusion that triggered the report; without it operators cannot reason about what Sync will do even with the P1 guard in place.

**Independent Test**: Open the Files tab of a Running agent — a hint explains the displayed copy is the shared one and the running agent may hold newer content, with Sync offered as the way to bring it in. For a stopped agent, no such hint appears.

**Acceptance Scenarios**:

1. **Given** an agent in Running state, **When** the operator opens the Files tab, **Then** a visible hint states the tab shows the shared copy, the running agent may hold newer content, and offers Sync.
2. **Given** an agent that is stopped, **When** the operator opens the Files tab, **Then** no stale-copy hint is shown (the shared copy is the only copy).
3. **Given** the Files tab is open, **When** the operator reads any file's details, **Then** the file's last-modified time of the shared copy is visible.

---

### User Story 3 - Admin agent stops promising what it cannot do and surfaces restart (Priority: P3)

An operator asks the admin agent to "create an agent and bind a knowledge base". Today the admin agent narrates doing both, though its toolset can do neither. After this feature, the admin agent's promises match its actual abilities, and when it writes an agent file it tells the operator a restart is required (or proposes the restart itself).

**Why this priority**: Trust/expectation damage rather than data loss; independent of the Sync mechanics.

**Independent Test**: Ask the admin agent to create an agent and bind a knowledge base; verify the reply either performs the action with a real tool or honestly states the limitation and points to the manual path. Ask it to write an agent file; verify the restart requirement is surfaced in the reply.

**Acceptance Scenarios**:

1. **Given** the admin agent chat, **When** the operator requests an action outside the toolset (create agent, bind knowledge base), **Then** the admin agent does not claim to perform it — it explains the limitation and points to the manual path (decided: instructions are constrained in this feature; real tools arrive in a follow-up ticket).
2. **Given** the admin agent writes an agent file, **When** it reports the result, **Then** the reply states a restart is required for the change to take effect and offers/suggests the restart action.

---

### Edge Cases

- Agent offline / not connected when Sync is pressed → keep today's behavior (Sync reports the agent is offline; no conflict check needed).
- Agent restarted after shared-copy edits → its working copy is fresh; Sync must show no false-positive warnings.
- File created only in the shared copy after the agent booted → Sync must not remove or overwrite it (verified: today it does not; behavior must be preserved).
- The agent's working copy lost all files → existing "refuse to delete everything" safeguard must remain in force.
- Clock skew between systems → conflict detection relies only on moments the platform itself records (agent start, last completed Sync) compared against shared-storage change times, with a small tolerance margin; the running agent's own clock is never consulted (decided: Q2).
- Warning shown, operator walks away, agent keeps writing → confirmation acts on the state at confirmation time; the warning list may be refreshed on confirm.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST record, per agent and using its own clock domain, when the running agent last took files from the shared copy (agent start) and when the last Sync completed; the running agent's clock is not part of the comparison.
- **FR-002**: Before executing Sync, the system MUST identify shared-copy files that changed after the moment from FR-001 and that Sync would overwrite or remove.
- **FR-003**: When FR-002 finds at least one file at risk, the system MUST present the list to the operator and proceed only after explicit confirmation; cancelling MUST leave the shared copy untouched.
- **FR-004**: When FR-002 finds nothing at risk, Sync MUST proceed without additional friction.
- **FR-005**: Sync MUST continue to send only files actually changed in the agent's working copy and MUST NOT touch shared-copy files the agent never modified (preserve verified delta semantics).
- **FR-006**: The Files tab MUST tell the operator, for a running agent, that the displayed content is the shared copy and that the running agent may hold newer content, offering Sync as the remedy.
- **FR-007**: The Files tab MUST show each file's shared-copy last-modified time.
- **FR-008**: The admin agent MUST NOT claim to perform actions its toolset cannot perform: its instructions are constrained so that agent creation and knowledge-base binding requests get an honest limitation notice plus the manual path. Extending the toolset with those abilities is explicitly out of scope, tracked as a follow-up ticket.
- **FR-009**: After the admin agent writes an agent file, the operator-facing reply MUST state that a restart is required and offer the restart action.

### Key Entities

- **Shared copy**: The authoritative stored set of an agent's files; what the Files tab shows and what UI/admin-agent edits modify. Each file carries a last-modified time.
- **Working copy**: The running agent's private set of the same files, taken from the shared copy at boot, sent back (as a delta) only on Sync.
- **Sync operation**: Operator-triggered action that pushes the working-copy delta over the shared copy and removes files deleted in the working copy.
- **Sync markers (per agent)**: Times of last take (boot pull) and last send (successful Sync) — the reference points for conflict detection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero silent overwrites: 100% of Sync executions that would overwrite or remove a shared file changed since the agent's last take/send are preceded by a warning naming that file.
- **SC-002**: An operator with no knowledge of the internals can, within 10 seconds of opening the Files tab of a running agent, answer "am I looking at the latest content?" (the hint provides the answer).
- **SC-003**: Conflict-free Sync keeps its current speed: no extra confirmation step when nothing is at risk.
- **SC-004**: Zero admin-agent replies that narrate performing agent creation or knowledge binding without a tool actually doing it.
- **SC-005**: "My edit disappeared" reports for agent files drop to zero after release.

## Assumptions

- The warn-and-confirm approach (list of at-risk files + explicit confirmation) is sufficient for v1; a full per-file diff view before overwrite is out of scope.
- Conflict detection compares shared-copy object change times against platform-recorded take/send markers (Q2 decision); content hashing is not required in v1.
- Rancher toolset extension (agent creation, knowledge-base binding) is deliberately deferred to a follow-up ticket (Q1 decision); this feature only aligns the admin agent's promises with its current abilities.
- The Files tab hint applies to the Running state only; Starting/Stopped agents show no hint.
- Admin console stays English-only (per repo i18n policy); no `app` console changes are in scope.
- CLEAN-48 knowledge-isolation work does not touch the files stack; no dependency.
- The existing "agent offline" Sync handling and the "refuse to delete everything" safeguard remain unchanged.
