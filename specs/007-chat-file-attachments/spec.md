# Feature Specification: Chat File Attachments

**Feature Branch**: `feat/CLEAN-49-chat-file-attachments`

**Jira**: [CLEAN-49](https://dreamvention.atlassian.net/browse/CLEAN-49)

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Изучи репозиторий bridle и нашего ранча. Задача заключается в добавлении возможности прикрепить файл. Но так же приятным дополнением будет, определение drag-n-drop когда пользователь зажал чат, чтобы инпут заменялся на блок с пунктирной линией, обычное UX решение для загрузки файла. Так как в ranch эта возможность упущена, реализуй полный флоу чтобы обработать эту кнопку 'скрепку' и drag-n-drop"

## Context

The customer console's agent chat accepts text only. A person who wants the agent to look at a screenshot, a contract, or a spreadsheet has no way to hand it over — they must describe it in words or paste it as text. The chat transport already carries rich content (text, image, and file items travel end-to-end between browser, hub, and agent runtime), and the platform already stores files for other features. What is missing is everything the person actually touches: a way to pick a file, a way to drop one on the conversation, a way to see what is attached before sending, and a way to see it again in the transcript afterwards.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach a file with the paperclip button (Priority: P1)

A person chatting with their agent clicks a paperclip control in the message box, picks one or more files from their device, sees each one appear as a removable chip above the text field, types an optional note, and sends. The message goes out with the attachments and the agent responds to it.

**Why this priority**: This is the core ask. Without it there is no way to give an agent a file at all. It is a complete, shippable slice on its own — drag-and-drop is a convenience layered on the same mechanics.

**Independent Test**: Open a chat with a running agent, click the paperclip, select an image and a PDF, send with the text "what is in these?", and confirm the message appears in the transcript with both attachments listed and the agent replies.

**Acceptance Scenarios**:

1. **Given** a chat with a connected agent, **When** the person clicks the paperclip and picks a supported file, **Then** the file appears as a named chip with its size in the compose area and the send control becomes enabled even if the text field is empty.
2. **Given** one or more files staged in the compose area, **When** the person sends the message, **Then** the message appears in the transcript showing both the typed text (if any) and every attachment, the compose area empties, and the agent begins responding.
3. **Given** a staged file, **When** the person clicks its remove control, **Then** that file disappears from the compose area and is not sent, and remaining files stay staged.
4. **Given** the person picks a file whose type is not accepted, **When** the selection is confirmed, **Then** the file is rejected with a message naming the file and the reason, and any acceptable files in the same selection are still staged.
5. **Given** the person picks a file over the size limit, **When** the selection is confirmed, **Then** the file is rejected with a message stating the limit, and nothing is uploaded.
6. **Given** the maximum number of attachments is already staged, **When** the person opens the picker, **Then** the paperclip is disabled and its tooltip explains the limit.
7. **Given** an agent is currently replying, **When** the person looks at the compose area, **Then** the paperclip is disabled along with the rest of the compose controls, consistent with today's behavior for the text field and send button.

---

### User Story 2 - Drop a file onto the conversation (Priority: P2)

A person drags a file from their desktop over the chat. As soon as the file enters the chat area, the message box is replaced by a dashed-outline drop zone inviting them to release. Dropping the file stages it exactly as the paperclip would. Dragging back out restores the normal message box.

**Why this priority**: A well-understood convenience that makes the feature feel finished, but it is not required for someone to attach a file. It reuses every validation and staging rule from Story 1, so it can ship immediately after.

**Independent Test**: Drag an image file from the file manager over the chat area, confirm the compose area becomes a dashed drop zone, release, and confirm the file is staged identically to a paperclip selection.

**Acceptance Scenarios**:

1. **Given** the chat is open, **When** a drag carrying files enters the chat area, **Then** the compose area is replaced by a dashed-border drop zone with a short instruction, and the message list stays readable behind it.
2. **Given** the drop zone is showing, **When** the drag leaves the chat area without releasing, **Then** the normal compose area returns with any previously staged files and typed draft text untouched.
3. **Given** the drop zone is showing, **When** the person releases the files, **Then** the drop zone disappears, the files run through the same type, size, and count checks as the paperclip path, and the accepted ones are staged.
4. **Given** a drag that carries no files — for example selected text from another page — **When** it passes over the chat, **Then** no drop zone appears.
5. **Given** a drag passes over child elements inside the chat (message bubbles, avatars, the scroll area), **When** it moves between them, **Then** the drop zone stays visible without flickering.
6. **Given** a file is dropped anywhere outside the chat area, **When** it is released, **Then** the browser's default handling is prevented so the page does not navigate away from the conversation.
7. **Given** the compose area is disabled because the agent is replying, **When** files are dragged over the chat, **Then** the drop zone indicates that attaching is unavailable and a release stages nothing.

---

### User Story 3 - See attachments in the conversation history (Priority: P2)

After sending, the person sees their attachments rendered inside their own message bubble — images as inline thumbnails they can open full size, other files as named, clickable entries showing type and size. Reloading the page keeps them visible.

**Why this priority**: Without it the attachment vanishes the moment it is sent and the person cannot confirm what they gave the agent, or find it again later. It is separable from Story 1 (which can ship rendering only a plain "1 file attached" line) but the feature is not credible without it.

**Independent Test**: Send a message with an image and a PDF, confirm the image renders as a thumbnail and the PDF as a named entry in the sent bubble, reload the page, and confirm both are still shown.

**Acceptance Scenarios**:

1. **Given** a sent message with an image attachment, **When** it renders in the transcript, **Then** the image shows as a bounded thumbnail inside the bubble and opens at full size when clicked.
2. **Given** a sent message with a non-image attachment, **When** it renders in the transcript, **Then** it shows the file name, a type indicator, and the size, and activating it opens or downloads the file.
3. **Given** a conversation containing attachments, **When** the person reloads the page, **Then** the persisted history still shows every attachment with its name and, for images, its thumbnail.
4. **Given** an attachment whose stored file is no longer reachable, **When** the person opens it, **Then** they see a clear "no longer available" state rather than a broken image or a silent failure.
5. **Given** a very long file name, **When** it renders in a chip or a bubble, **Then** it is truncated in the middle with the extension preserved and the full name available on hover.

---

### User Story 4 - Recover from a failed attachment (Priority: P3)

Uploads fail — the network drops, the file is corrupt, storage is unreachable. The person is told which file failed and can retry or remove it without losing their typed message or their other attachments.

**Why this priority**: Protects against the most annoying failure mode (losing a written message because one upload broke), but the happy path is deliverable without it.

**Independent Test**: Stage two files, simulate a failure for one, and confirm the failure is shown per-file with a retry, the other file stays staged, and the typed text is preserved.

**Acceptance Scenarios**:

1. **Given** a staged file whose upload fails, **When** the failure is detected, **Then** that file's chip shows an error state with a retry control, and the typed text and other staged files are untouched.
2. **Given** a file in an error state, **When** the person retries and it succeeds, **Then** the chip returns to its normal state and the message can be sent.
3. **Given** a message where at least one attachment is still uploading, **When** the person presses send, **Then** sending waits for the uploads to settle rather than sending an incomplete message, with a visible in-progress indication.
4. **Given** a message where an attachment is in a permanent error state, **When** the person presses send, **Then** they are told the message cannot be sent until that file is removed or retried.

---

### Edge Cases

- **Empty message, attachment only**: sending with attachments and no text is allowed; sending with neither is not.
- **Duplicate selection**: picking the same file twice stages it once, or shows both distinctly — either is acceptable so long as the count limit is enforced consistently.
- **Zero-byte file**: rejected with the same clarity as an oversized file.
- **Total payload limit**: several individually-legal files that together exceed the per-message total are rejected at the point the limit is crossed, naming the total limit.
- **Clipboard paste**: pasting an image from the clipboard into the message box stages it like any other attachment.
- **Navigating away with staged files**: leaving the conversation with unsent attachments discards them; no orphaned upload is left occupying storage indefinitely.
- **Agent disconnected**: attaching is still possible, but sending surfaces the same "cannot reach agent" state the chat already shows for text.
- **Mobile / touch**: the paperclip works on touch devices where drag-and-drop does not exist; the drop zone simply never appears.
- **Slow upload**: a large file shows progress rather than an unexplained delay before the message can be sent.
- **Attachment the agent cannot read**: a binary format such as PDF is delivered as a named reference, and the person is warned at attach time rather than misled by a confused reply (see FR-021).
- **Oversized text file**: a text-based attachment longer than the inclusion limit is still sent, with the included portion truncated and both the agent and the person told that it was cut.
- **Text file that is not really text**: a file with a text extension whose contents are binary or undecodable is treated as a binary reference rather than producing garbled content in the message.

## Requirements *(mandatory)*

### Functional Requirements

**Attaching**

- **FR-001**: The compose area MUST offer a clearly labelled attach control that opens the device's file picker with multiple selection allowed.
- **FR-002**: The system MUST accept, at minimum, common images (PNG, JPEG, GIF, WebP), PDF, and plain-text formats (TXT, Markdown, CSV, JSON), and MUST reject other types with a message naming the file and the accepted kinds.
- **FR-003**: The system MUST reject any single file larger than 10 MB and any message whose attachments total more than 25 MB, stating the exceeded limit.
- **FR-004**: The system MUST allow at most 5 attachments per message and MUST disable the attach control, with an explanatory tooltip, once that count is reached.
- **FR-005**: Each staged file MUST be shown before sending with its name, size, a type or thumbnail indicator, and an individual remove control.
- **FR-006**: The send control MUST be enabled when at least one attachment is staged even with no typed text, and MUST stay disabled when neither text nor attachment is present.
- **FR-007**: All attach affordances MUST be disabled while the agent is generating a reply, matching the existing behavior of the text field and send button.

**Drag and drop**

- **FR-008**: While a drag carrying files is over the chat area, the system MUST replace the compose area with a dashed-border drop zone carrying a short instruction.
- **FR-009**: The drop zone MUST NOT appear for drags that carry no files.
- **FR-010**: The drop zone MUST remain stable while the pointer moves across nested elements inside the chat, and MUST disappear when the drag leaves the chat area or completes.
- **FR-011**: Dropping files MUST stage them through exactly the same type, size, count, and total-size rules as the picker path.
- **FR-012**: Releasing a drag MUST NOT cause the browser to navigate away from the conversation, whether the release lands inside or outside the drop zone.
- **FR-013**: Restoring the compose area after a drag MUST preserve any typed draft text and previously staged files.

**Delivery to the agent**

- **FR-014**: Attachments MUST be stored so that the file survives the send and is retrievable later for display in the transcript.
- **FR-015**: A stored attachment MUST be reachable only by people entitled to see the conversation it belongs to; it MUST NOT be exposed at a publicly guessable, unauthenticated address.
- **FR-016**: The outgoing message MUST carry each attachment alongside the text in the chat protocol's rich-content form — images as image content and other files as file references with name and type — so the agent receives them in one turn together with the text.
- **FR-017**: The system MUST NOT send a message until every attachment on it has been stored successfully.
- **FR-018**: An attachment that fails to store MUST be reported against that specific file with a retry option, leaving the draft text and the other attachments intact.

**What the agent actually receives**

- **FR-019**: Image attachments MUST be delivered in the form the agent already understands as viewable image content, so the agent can describe and reason about the picture itself.
- **FR-020**: Text-based attachments (TXT, Markdown, CSV, JSON) MUST have their contents read at send time and carried into the message the agent receives, so the agent can act on the file without fetching anything. Content beyond a per-file limit of 100,000 characters MUST be truncated with an explicit notice in place of the removed portion, and the person MUST be told in the compose area when truncation will occur.
- **FR-021**: Attachments the agent cannot read directly — PDF and other binary formats — MUST still be delivered as a named reference the agent can quote. At attach time the person MUST be told, on that file's chip, that the agent will see its name but not its contents, so they are never misled by a confused reply.

**Display and persistence**

- **FR-022**: A sent message MUST render its attachments inside the sender's bubble — images as bounded thumbnails openable at full size, other files as named entries showing type and size and openable on activation.
- **FR-023**: Attachments MUST survive a page reload as part of the persisted conversation, showing at least the file name and, for images, the thumbnail.
- **FR-024**: An attachment whose stored file can no longer be retrieved MUST render as an explicit unavailable state, never as a broken image or a dead control.

**Cross-cutting**

- **FR-025**: Every new person-visible string MUST exist as an English source key in the owning slice's locale file, with the Russian translation generated by the project's sync process — never hand-written first.
- **FR-026**: All attach and drop affordances MUST be reachable by keyboard and carry accessible labels, and every rejection or failure MUST be announced to assistive technology rather than conveyed by color alone.
- **FR-027**: The feature MUST apply to the customer console's agent chat. The admin debug chat and the embeddable widget are explicitly out of scope for this feature and MUST be left unchanged.

### Key Entities

- **Staged attachment**: a file the person has chosen but not yet sent. Holds the file itself, its name, size, and type, a local preview for images, and a state (staging, uploading, ready, failed). Lives only in the compose area and is discarded if the person navigates away or removes it.
- **Message attachment**: a stored file bound to a sent message. Holds the file's name, size, type, and a retrieval reference. Rendered in the transcript and delivered to the agent as part of the message.
- **Attachment store**: where a message attachment's bytes live between sending and viewing. Access is governed by who may read the owning conversation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can attach a file and send it in under 15 seconds from opening the chat, using either the button or a drag, without instruction.
- **SC-002**: 100% of files that violate a type, size, or count rule are rejected with a message that names the file and the rule; none are silently dropped.
- **SC-003**: A 5 MB attachment is staged and ready to send within 5 seconds on a normal broadband connection, with visible progress throughout.
- **SC-004**: The drop zone appears within one animation frame of a file-carrying drag entering the chat and never flickers while the pointer crosses nested elements.
- **SC-005**: 100% of sent attachments are still visible in the transcript after a page reload.
- **SC-006**: No message is ever sent with an attachment that failed to store — the send is blocked and explained in every such case.
- **SC-007**: A person whose upload fails never loses their typed message or their other staged files.
- **SC-008**: In usability testing, 9 of 10 people attach a file successfully on the first attempt without asking how.
- **SC-009**: Every person-visible string renders correctly in both English and Russian, with no untranslated key text reaching the screen.
- **SC-010**: An agent asked a question about an attached text, Markdown, CSV, or JSON file answers from the file's actual contents, not from its name — verified on all four formats.
- **SC-011**: Every attachment the agent cannot read is flagged as such in the compose area before sending, so nobody sends a PDF expecting it to be read.

## Assumptions

- **Surfaces — decided**: the customer console's agent chat only. The admin debug chat and the embeddable widget in the separate chat-relay repository are out of scope and stay as they are. Widening to either is a separate ticket.
- **Transport**: the existing chat protocol already carries text, image, and file content items end-to-end and needs no protocol change; the work is the person-facing flow plus storage on top of it.
- **Storage**: the platform's existing object storage is reused rather than introducing a new store, and files are served through an authenticated application route rather than a public bucket URL, consistent with how other stored files in the platform are reached.
- **Reaching the model — decided**: the agent runtime folds image content into what the model sees but discards file references before calling the model. Rather than change the separate agent-runtime repository, this feature closes the gap on its own side: text-based files have their contents read and carried in the message (FR-020), and binary files travel as a named reference with the person warned up front (FR-021). Having the agent fetch and parse arbitrary binaries itself remains possible later and would be its own ticket against the agent-runtime repository.
- **Text extraction limit**: 100,000 characters per file is chosen as a default that comfortably covers ordinary documents and spreadsheets while staying well inside what a model turn can carry. It is configurable rather than hard-coded.
- **Limits**: 5 files, 10 MB each, 25 MB total per message are chosen as defaults in line with common chat products and the 5-attachment cap already used by the embeddable widget. They are configurable rather than hard-coded.
- **Retention**: attachments live as long as the conversation they belong to and are removed with it; no separate retention policy is introduced.
- **Sending model**: the console's chat currently sends over the synchronous request path rather than the live socket; attachments follow the same path, and no change to streaming behavior is implied.
- **Anti-virus scanning, on-the-fly format conversion, and editing an attachment after sending are out of scope.**

## Dependencies

- Existing object storage configuration must be present and reachable in the target environment for uploads to succeed.
- The chat protocol's rich-content message format (text / image / file items) is depended upon as-is; no change to it is required.
- No change in the separate agent-runtime repository is required. Having the agent fetch and parse binary attachments itself would be, and is deliberately left out.

## Out of Scope

- The admin debug chat and the embeddable chat widget — both keep their current behavior.
- Anti-virus or malware scanning of uploaded files.
- Extracting text from binary document formats (PDF, DOCX, XLSX) — these travel as named references.
- Editing, replacing, or removing an attachment after the message has been sent.
- Attachments on the agent's own outgoing messages; this feature covers what the person sends.
