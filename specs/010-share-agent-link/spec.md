# Feature Specification: Share an agent by public link (chat without an account)

**Feature Branch**: `feat/CLEAN-66-share-agent-link`

**Created**: 2026-09-07

**Status**: Draft

**Jira**: [CLEAN-66](https://dreamvention.atlassian.net/browse/CLEAN-66) (related: [CLEAN-62](https://dreamvention.atlassian.net/browse/CLEAN-62) — single-agent chat page for *logged-in* users)

**Input**: User description: "Задача реализовать share app агента для пользователя без авторизации, на странице каждого агента - появляется справа кнопка share, которая генерирует ссылку, для того чтобы поделиться этим агентом (формат "/share?token="), тот кто открывает ссылку, видит только окно с агентом, в full view, ничего лишнего и может чатиться с ним. У пользователя который пошарил сессию, должна быть кнопка - revoke, чтобы откатить, и перегенерация ссылки. Так же дополнение функционала (под вопросом) Что насчет пинкода, который должен вводить пользователь, перед использованием бота, этот пинкод только у того, кто раздает ссылку, чтобы если ктото украл ссылку, у него не было доступа без пинкода. Насколько это маст хев и не перенагружает ли логику? это хотелось бы обсудить"

## Background

Today a person can only talk to an agent in the customer console after logging in, or through a website embed that the agent explicitly whitelists by domain (`isPublic` + allowed origins). There is no way for a console user to hand a colleague, a client, or a tester a link that just opens a chat with one agent. This feature adds that: a share link that carries its own secret, works without an account, shows nothing but the chat, and can be killed or rotated by the person who created it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Owner shares an agent with one click (Priority: P1)

A logged-in console user opens an agent's page and sees a **Share** button on the right side of the page header. Clicking it creates a share link for this agent (format `<console origin>/share?token=<secret>`), shows it in a small panel with a **Copy** action, and confirms that the link is now active. Reopening the panel later shows the same link, not a new one.

**Why this priority**: Without a link there is nothing to share; this is the core of the feature and the only story that needs to exist for the feature to deliver value.

**Independent Test**: Log in, open any agent, press Share, copy the link. Verify the panel shows an active link, and that opening the agent page again shows the same link.

**Acceptance Scenarios**:

1. **Given** a logged-in user on an agent page with no share link yet, **When** they press Share, **Then** a link of the form `/share?token=…` is generated, displayed, and marked active, and the user can copy it in one click.
2. **Given** an agent that already has an active share link, **When** the user opens the Share panel, **Then** the existing link is shown (no new link is minted) together with Revoke and Regenerate actions.
3. **Given** the Share panel is open, **When** the user presses Copy, **Then** the full absolute link is placed on the clipboard and a short confirmation is shown.

---

### User Story 2 - Recipient chats with the agent without an account (Priority: P1)

A person who receives the link opens it in a browser. They are not asked to log in. They see a full-screen chat with the agent: the agent's name as the title, the message history of *their* conversation, the composer, and nothing else — no console header, no navigation, no agent or chat lists, no settings. They can send messages, attach files and images, and receive answers exactly as a logged-in user would in the agent's chat. If they reload or come back later in the same browser, their conversation is still there.

**Why this priority**: The recipient side is the other half of the core value; a link that opens a login form is the existing CLEAN-62 behaviour, not this feature.

**Independent Test**: Open the copied link in a private/incognito window. Verify no login is required, only the chat is visible, a message gets an answer, and after a page reload the same conversation is still shown.

**Acceptance Scenarios**:

1. **Given** a valid active link, **When** a visitor opens it in a browser without a console session, **Then** the chat with that agent is shown full-view, with no console navigation, and the visitor can send a message and receive a reply.
2. **Given** a visitor has exchanged messages via the link, **When** they reload the page or reopen the link later in the same browser, **Then** their previous messages are shown and the conversation continues.
3. **Given** two different people open the same link on different devices, **When** each sends messages, **Then** each sees only their own conversation with the agent.
4. **Given** a valid link, **When** a visitor who is *also* logged into the console opens it, **Then** the page still shows the full-view chat (no redirect to the normal console UI).
5. **Given** the agent behind the link is not currently running or reachable, **When** a visitor opens the link, **Then** the chat shows a clear "agent is unavailable right now" state instead of a broken or empty screen, and recovers when the agent comes back.
6. **Given** a valid link, **When** a visitor attaches a file or image and sends it, **Then** the agent receives it exactly as it would from a console user, and the visitor can open their own attachments again after a reload.

---

### User Story 3 - Owner revokes or regenerates the link (Priority: P2)

From the same Share panel the owner can press **Revoke** to disable the link, or **Regenerate** to replace it with a fresh one. After Revoke the old link stops working immediately, and the panel returns to the "not shared" state. After Regenerate the old link stops working, and a new link is shown, ready to copy. Visitors who are mid-conversation on a revoked link lose access at that moment and see a clear "this link is no longer active" message.

**Why this priority**: Sharing a bearer link without a way to take it back is not acceptable, but revocation is only meaningful once stories 1 and 2 exist.

**Independent Test**: Share an agent, open the link in a second browser, then press Revoke in the first. Verify the second browser can no longer chat and shows the "no longer active" message; verify a Regenerate produces a link that works while the previous one does not.

**Acceptance Scenarios**:

1. **Given** an agent with an active link, **When** the owner presses Revoke and confirms, **Then** the link is invalidated, the panel shows the agent as not shared, and opening the old link shows "link is no longer active".
2. **Given** an agent with an active link, **When** the owner presses Regenerate, **Then** a new link is shown and marked active, and the previous link behaves as revoked.
3. **Given** a visitor has the chat open on a link, **When** that link is revoked or regenerated, **Then** the visitor's chat stops accepting messages and shows the "no longer active" message without needing a reload.
4. **Given** a link was revoked, **When** the owner presses Share again, **Then** a brand-new link is created (the revoked token is never reused).

---

### Follow-up (out of scope for v1) - Optional PIN gate on the link

Decided 2026-09-07: not in v1. A later ticket may let the owner set a short PIN that visitors enter once per browser before the chat opens (rate-limited, never shown to visitors, reset on Regenerate). The Share Link entity and the `/share?token=` format MUST NOT need to change to add it.

---

### Edge Cases

- **Malformed, unknown, or expired token** in `/share?token=`: the page shows a friendly "This link is invalid or no longer active" state; no agent name or other details are leaked.
- **Link for an agent that was deleted**: behaves as an invalid link.
- **Agent stopped / failed / not connected to the hub** while the link is valid: chat shows an "agent is unavailable" state and reconnects when the agent is back; the link itself stays valid.
- **Owner opens their own link while logged in**: gets the same full-view chat as any visitor (their visitor conversation is separate from their console conversation with the agent).
- **Two console users share the same agent**: there is exactly one active link per agent; both see and can revoke/regenerate the same link (see Assumptions).
- **Visitor clears browser storage or switches browsers**: they get a fresh, empty conversation; the old one remains in the agent's history.
- **Token appears in the URL bar, history, and any link preview**: the token grants chat only — never any console page or data about other agents. The page must not send the token to third parties (no analytics, no external requests carrying the URL).
- **Attachments and images**: visitors get the same attach controls and limits as console users. A visitor can open only attachments from their own conversation; an attachment id from another conversation is refused.
- **Very long sessions**: the visitor's connection is renewed transparently; a valid link never forces the visitor to "log in".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The agent page in the customer console MUST show a **Share** action in the right-hand area of its header for every agent the user can open.
- **FR-002**: Pressing Share on an agent with no active link MUST create a share link for that agent and display it as an absolute URL of the form `<console origin>/share?token=<secret>`.
- **FR-003**: The token MUST be an unguessable secret of at least 128 bits of entropy, unique per link, and MUST NOT encode the agent id or any other readable information.
- **FR-004**: At most one active share link MUST exist per agent at any time; opening the Share panel on an agent that already has an active link MUST show that link rather than mint a new one.
- **FR-005**: The Share panel MUST offer **Copy**, **Revoke**, and **Regenerate** actions while a link is active, and only **Share** (create) when it is not.
- **FR-006**: Revoke MUST invalidate the link immediately: any new visit with that token is rejected, and any live visitor session on that token is disconnected with a "link is no longer active" message.
- **FR-007**: Regenerate MUST atomically invalidate the current link and create a new one; the old token MUST never become valid again.
- **FR-008**: Opening `/share?token=<valid token>` MUST render a full-view chat with the linked agent **without requiring login**, regardless of whether the browser has a console session.
- **FR-009**: The share page MUST contain only: the agent's display name, the conversation, the composer, and connection/error states. It MUST NOT show console navigation, agent/chat lists, user menu, settings, or links into the console.
- **FR-010**: Visitors on a share link MUST be able to send messages and receive replies with the same behaviour (pending indicator, error states) as the console chat for that agent.
- **FR-011**: Each visitor MUST get their own conversation with the agent, stable across page reloads in the same browser; different visitors of the same link MUST NOT see each other's messages.
- **FR-012**: Conversations held via a share link MUST appear in the agent's chat history for console users like any other channel, distinguishable as coming from a share link.
- **FR-013**: The share page MUST reject invalid, revoked, or unknown tokens with a friendly error state that reveals nothing about the agent.
- **FR-014**: A share token MUST grant nothing beyond chatting with its single agent, including uploading attachments for that chat and reading back the visitor's own attachments: no console pages, no agent details, no other agents' data, no other visitors' attachments, no file listing or settings.
- **FR-015**: When the agent is not running or not connected, the share page MUST show an "agent unavailable" state and resume automatically when the agent becomes reachable, without the visitor re-opening the link.
- **FR-016**: Share links MUST NOT expire on their own; a token stays valid until revoked or regenerated. The token is an opaque server-side secret, not a time-limited login token; any short-lived credential the visitor's connection uses internally MUST be renewed transparently while the share token is valid.
- **FR-017**: The owner-side share state (active or not, when created, by whom) MUST survive page reloads and be visible to any console user who opens the agent.
- **FR-018**: All new user-visible copy on the console side MUST follow the console i18n convention (English source, generated Russian). The visitor page MUST render in the console's default language and follow the same convention.
- **FR-019** *(only if the PIN option is accepted)*: The owner MUST be able to set a 4–6 digit PIN on an active link; visitors MUST enter it once per browser before the chat is shown; wrong attempts MUST be rate-limited; the PIN MUST never be shown to a visitor or sent to them by the system.

### Key Entities *(include if feature involves data)*

- **Share Link**: the shareable grant for one agent. Attributes: the agent it belongs to, the secret token, whether it is active or revoked, who created it and when, when it was last revoked or rotated, and how many times it was rotated. Exactly one record per agent; Revoke marks it inactive, Regenerate replaces the token in place. Designed so an optional PIN can be added later without changing the link format.
- **Visitor Conversation**: a conversation between one anonymous visitor and the agent, opened through a share link. Identified by a stable per-browser visitor id, attached to the share link and the agent. Appears in the agent's chat history as its own channel.
- **Agent**: existing entity; gains the relationship to its share link(s). Its existing "public embed" setting is independent from share links and is not changed by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A console user can go from the agent page to a copied share link in under 10 seconds and no more than 2 clicks (Share, Copy).
- **SC-002**: A recipient with no account can send a first message and see an answer within 30 seconds of opening the link, with zero sign-in steps.
- **SC-003**: After Revoke or Regenerate, the old link is rejected on 100% of new visits and on every subsequent message from an already-open page; an open page learns of the revocation within 30 seconds without a reload.
- **SC-004**: A visitor returning to the same link in the same browser sees their previous conversation in 100% of cases (no fresh empty chat).
- **SC-005**: The share page exposes exactly one agent: no request made by the page returns data about any other agent or console resource (verified by review of the page's network activity).
- **SC-006**: 100% of console users in a hallway test recognise the share panel's state (shared / not shared) and find Revoke without guidance.

## Clarifications

### Session 2026-09-07

- Q: Should v1 ship a PIN gate on the link (User Story 4 / FR-019)? → A: **No.** Out of scope for v1. Revoke + Regenerate cover the "link leaked" case; the Share Link entity stays ready for an optional PIN later. User Story 4 and FR-019 are kept below as a follow-up note only.
- Q: Who may create/revoke/regenerate a share link? → A: **Any logged-in console user** who can open the agent page, matching today's model where any user can chat with any agent.
- Q: How long does the token in `/share?token=` live? → A: **Until Revoke or Regenerate, never on its own.** The share token is an opaque random secret looked up on the server, not a time-limited login token. The visitor's live connection may use short-lived internal credentials behind the scenes, but those are renewed transparently from the still-valid share token; the visitor never sees an expiry and never has to re-open the link.
- Q: Do share visitors get attachments? → A: **Yes.** Attachments are standard chat functionality; a visitor uploads through the same route as the console and can read back only attachments from their own conversation.
- Design note (plan, 2026-09-07): the console chat is request/response over HTTP, so an open visitor page detects revocation on its next message and by re-checking the link every 30 s while visible (SC-003 reworded). One link record per agent; old tokens are not retained. Attachments are available to visitors with the same limits as the console; a visitor can read back only their own.

## Assumptions

- Any console user who can open an agent's page can chat with it today; sharing follows the same model (confirmed in Clarifications).
- One active link per agent is enough for v1. Multiple named links per agent (per client, per campaign) are out of scope.
- No expiry date on links in v1; revocation is manual. An optional expiry can be added later without changing the link format.
- The visitor is identified by a stable id kept in the browser, the same approach the existing website embed uses for anonymous visitors; losing browser storage means losing the conversation from the visitor's side only.
- Visitor conversations are stored and listed like every other channel; no separate retention policy for them.
- The share page lives in the customer console (`app`) under `/share`; the admin panel is not touched except that shared conversations show up in the chat history it already lists.
- The existing "public embed" mechanism (agent flag + allowed origins) is unrelated and stays as is; share links do not require the agent to be marked public.
- Attachments are part of the visitor chat (decided 2026-09-07): same controls, size and type limits as the console.
- Console users see the share state and actions on the agent page; there is no separate "all my shared agents" list in v1.
