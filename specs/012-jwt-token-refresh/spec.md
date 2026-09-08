# Feature Specification: Session stays alive while you work, and ends honestly when it cannot

**Feature Branch**: `feat/CLEAN-72-jwt-token-refresh`

**Created**: 2026-09-08

**Status**: Draft — research complete, ready for `/speckit-plan`

**Tracker**: [CLEAN-72](https://dreamvention.atlassian.net/browse/CLEAN-72)

**Research**: [`research.md`](./research.md) — the current-state audit this specification is built on, with file-level evidence and the option comparison.

**Input**: User description: "Я бы хотел изначально провести ресерч, касательно необходимости имплементировать рефреш механизм для токена. Флоу бага такой, у нас открыта сессия с агентом. Браузер неактивен некоторое время. JWT токен со своим временем жизни. Мы начинаем новую сессию и у нас сверху чата отображается alert что invalid токен. Как мы можем это корректно исправить?"

## Overview

A person signs in to a console, opens an agent chat, and leaves the tab. When they come back — an hour, a day, a week later — the chat greets them with a red box saying the token is invalid. Nothing renews the session token while they use the product, nothing notices when it dies, and when it does die every part of the console reacts differently: one part bounces to the login page, one paints the raw error into the chat, one quietly keeps chatting as an anonymous stranger with no history, and the admin chat sits "offline" until someone reloads the page.

The research answers the question that was asked: **yes, a renewal mechanism is needed**, but a full refresh-token infrastructure is not. The session should renew itself as long as the person keeps using the product, and when it cannot be renewed — they were away longer than the session lifetime, the server's signing secret changed, their account was removed — the console should say so once, in one place, and take them back to the exact chat after they sign in again.

This holds for **both consoles**: the user console (`app`) where the bug was reported, and the admin console, where the same expiry leaves the live chat permanently disconnected. The public share-link chat is a different visitor path that already handles a dead console session on purpose, and it must keep working exactly as it does.

Out of scope, deliberately: server-side revocation, short-lived access tokens with a separate refresh token, multi-device session lists, "remember me" choices, and any change to the agent service, embed, or browser-extension token families. These are catalogued in the research as the natural next step if revocation ever becomes a requirement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A session I keep using never expires under me (Priority: P1)

An operator keeps the console open across the working week. They chat with agents daily, sometimes leaving the tab for hours or overnight. They are never asked to sign in again as long as they come back within the session lifetime, and they never see an authentication error in the middle of their work.

**Why this priority**: This is the failure the ticket reports and the one people hit most: a tab left open, then a dead session. Renewal while the product is in use removes the cause for everyone who returns within the lifetime, which is nearly everyone.

**Independent Test**: Sign in with the session lifetime shortened to minutes. Keep interacting past the original expiry moment. Every action succeeds, no login prompt appears, and the session's expiry has moved forward each time it was close to running out.

**Acceptance Scenarios**:

1. **Given** a signed-in operator whose session is close to expiring, **When** they perform any action in the console (send a message, open a chat, upload a file), **Then** the action succeeds and the session's remaining lifetime is extended without any prompt.
2. **Given** a tab that was hidden or in the background for less than the session lifetime, **When** the person returns to it, **Then** the console renews the session before their next action and nothing they do fails for authentication reasons.
3. **Given** an operator who opens the console fresh (new tab, reload) with a still-valid but ageing session, **When** the console starts, **Then** it renews the session as part of start-up and the person lands where they were going.
4. **Given** a tab left open and completely untouched for longer than the session lifetime, **When** the person returns, **Then** the session has lapsed normally (see User Story 2) — a renewed session always requires the person to have been present.

---

### User Story 2 - When the session is gone, I am told once and returned to where I was (Priority: P1)

A person comes back to a chat after being away longer than the session lifetime (or after the team rotated the server's signing secret). Instead of a red box quoting an internal error, the console shows one clear "your session has ended, sign in to continue" state. Signing in brings them straight back to the same agent chat they were looking at, with its history intact.

**Why this priority**: Renewal cannot cover every case. This story is the safety net for all of them and is what turns the reported bug from "confusing and broken" into "expected and quick". It is P1 together with Story 1 because either alone leaves the reported experience in place for part of the audience.

**Independent Test**: Sign in, then make the session invalid on the server side (let it expire, or change the signing secret). Return to an open chat and send a message. Exactly one session-ended state appears, no raw error text is shown anywhere, and after signing in the person is back in the same chat.

**Acceptance Scenarios**:

1. **Given** an operator on an agent chat whose session has expired, **When** they send a message, **Then** the message is not sent as an anonymous visitor, no raw error string appears in the chat, and the console presents the session-ended state.
2. **Given** the session-ended state, **When** the person signs in again, **Then** they land on the same chat they were on, with the same conversation history and the message they tried to send still available to resend.
3. **Given** an operator whose session was signed with a secret the server no longer accepts, **When** they return, **Then** they get the same session-ended experience as an expired session, and the platform's own records let a maintainer tell the two causes apart.
4. **Given** several requests failing at once because the session is gone (chat, restart, share panel), **When** the console reacts, **Then** only one session-ended state is shown, not one banner per failed request.
5. **Given** a visitor on a public share-link chat in the same browser as a dead console session, **When** they use the share chat, **Then** it keeps working as today and they are never sent to the console login.

---

### User Story 3 - The admin live chat recovers on its own (Priority: P2)

An admin has the agent workspace open with its live chat connection. After the session renews, or after a reconnect, the live connection uses the current session and keeps streaming. If the session cannot be renewed, the live chat stops showing "reconnecting" forever and joins the same session-ended state as everything else.

**Why this priority**: The admin console is affected by the same root cause, but its symptom is a stuck "offline" rather than a red box. It matters for the people operating agents day-long, and it needs the pieces from Stories 1 and 2 to exist first.

**Independent Test**: In the admin agent workspace, let the session renew (short lifetime) and confirm the live chat keeps streaming across the renewal and across a forced reconnect. Then invalidate the session and confirm the workspace shows the session-ended state instead of a perpetual reconnecting indicator.

**Acceptance Scenarios**:

1. **Given** an admin with a live chat open whose session has just been renewed, **When** the connection reconnects for any reason, **Then** it connects with the renewed session and streaming continues without a page reload.
2. **Given** an admin whose session can no longer be renewed, **When** the live connection is rejected for authentication, **Then** the workspace shows the session-ended state within a few seconds instead of an indefinite reconnecting indicator.
3. **Given** an admin uploading an attachment after a renewal, **When** the upload runs, **Then** it uses the current session and succeeds rather than failing with an authorization error.

---

### Edge Cases

- Two tabs of the same console open at once: renewal in one tab must not invalidate or confuse the other; both keep working with the newest session.
- A renewal attempt races with the person's own action at the exact expiry moment: the action must either wait for the renewal or be retried once transparently — never fail with an authentication error.
- Renewal is requested for a session that is already expired: it is refused, and the console goes to the session-ended state instead of looping on renewal attempts.
- The person is signed out explicitly: no renewal happens afterwards, and any pending renewal result is discarded.
- The account behind a valid session is removed or its role changes: renewal is refused, and the person sees the session-ended state rather than continuing with stale permissions.
- The server is unreachable during a renewal attempt: the console does not treat a network failure as an ended session; it keeps the current session until it actually expires and retries renewal later.
- A message was sent with an expired session in the old behaviour: it must no longer be delivered as an anonymous visitor; the person sees the session-ended state and the message is preserved for resend.
- A local environment without a configured signing secret: the platform must not mint sessions it cannot itself verify; start-up fails clearly or one shared fallback is used everywhere.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST let a signed-in person obtain a renewed session, with a fresh full lifetime, by presenting their current still-valid session — without re-entering credentials.
- **FR-002**: Renewal MUST be refused for a session that is expired, was signed with a secret the platform no longer accepts, or belongs to an account that no longer exists; refusal MUST NOT reveal which of these applied to the requester, but MUST be distinguishable in the platform's own logs.
- **FR-003**: Each console MUST renew the session on its own whenever the remaining lifetime falls below a threshold and the person is actively using the product, including at console start-up and when a hidden tab becomes visible again. A completely untouched tab MUST NOT keep a session alive past its lifetime.
- **FR-004**: Every request a console makes MUST carry the current session, including live connections and direct uploads that today capture the session once; a renewal MUST take effect for all of them without a page reload.
- **FR-005**: When the platform rejects a session, the response MUST carry a machine-readable reason that lets a console distinguish "session expired" from "session invalid" from "no session provided".
- **FR-006**: The chat message path MUST NOT silently treat an expired or invalid console session as an anonymous visitor. A request that presents a console session that cannot be verified MUST be rejected as an authentication failure; a request that presents no console session at all keeps today's anonymous behaviour.
- **FR-007**: Each console MUST present a single session-ended state when a session cannot be renewed and a request is rejected for authentication, regardless of how many requests failed. This state MUST use product copy, never the platform's internal error text.
- **FR-008**: Signing in from the session-ended state MUST return the person to the page and chat they were on, with conversation history preserved and any unsent message kept for resend.
- **FR-009**: The admin live chat connection MUST react to an authentication rejection by moving to the session-ended state, and MUST reconnect using the current session after a renewal.
- **FR-010**: The public share-link chat MUST keep its current behaviour: a dead console session in the same browser MUST NOT interrupt a visitor, redirect them, or show them the session-ended state.
- **FR-011**: Explicit sign-out MUST stop all renewal activity for that session in that browser.
- **FR-012**: The user console's user-facing copy for the session-ended state MUST follow the console's i18n process (source strings in the slice's English locale, generated Russian, keys in templates).

### Key Entities

- **Session**: the proof a console holds that a person is signed in. Has an issue moment, an expiry moment, and the identity and roles it represents. Renewal replaces it with a new session of the same identity and a fresh lifetime.
- **Session-ended state**: the one console-wide condition shown when a session cannot be used or renewed. Carries the return destination (page, agent, chat) so sign-in can restore it.
- **Rejection reason**: the platform's categorisation of why a session was refused — missing, expired, or invalid — used by consoles to decide between renewing, ending the session, or ignoring the failure (share visitor).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who interacts with the console at least once within any session lifetime is never asked to sign in again and never sees an authentication error — 0 forced re-logins in a test week of daily use with a lifetime shortened to hours.
- **SC-002**: After the session has genuinely ended, 100% of test returns to an open chat show exactly one session-ended state and zero raw internal error strings, in both consoles.
- **SC-003**: After signing in from the session-ended state, the person is back on the same chat with its history in under 5 seconds and in one step (sign in — nothing else to click).
- **SC-004**: No message is ever delivered as an anonymous visitor on behalf of a signed-in person whose session expired: 0 anonymous chat channels created from requests that carried a console session, over the test period.
- **SC-005**: The admin live chat recovers from a renewal or a reconnect without a page reload in 100% of test runs, and shows the session-ended state within 10 seconds when the session cannot be renewed.
- **SC-006**: The public share-link chat behaves identically before and after this change in its existing acceptance scenarios (no regressions).
- **SC-007**: A maintainer can tell an "expired" rejection from an "invalid signature" rejection from the platform's logs alone, for 100% of rejections.

## Assumptions

- **Renewal shape**: sliding renewal of the single session (option B in the research) plus honest expiry handling (option C). A separate long-lived refresh credential with server-side storage and revocation (option A) is explicitly deferred; nothing in this feature should preclude adding it later.
- **Session lifetime** stays at its current configured value (7 days in every environment). The renewal threshold is a planning detail; the intent is "renew well before expiry whenever the person is present", not "renew on every request".
- **"Actively using the product"** means the tab is visible and the person has interacted with it or the console is performing an action on their behalf; a hidden, idle tab does not renew.
- **Session-ended state UX**: an in-place, dismiss-free state with a sign-in action is preferred over a hard redirect that loses the page. The exact presentation (modal vs. full-page interstitial) is a design detail; the requirement is one state, product copy, and return-to-place.
- **Both consoles** are in scope for Stories 1 and 2; Story 3 is admin-only because only the admin has a live connection. The user console's chat transport stays request-based.
- **Other token families** (agent service token, embed token, browser-extension tokens, share-link secret) are untouched.
- **Environments**: production and staging have a configured signing secret; the local-environment concern is limited to making the fallback consistent or failing fast.
