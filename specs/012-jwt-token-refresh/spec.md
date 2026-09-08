# Feature Specification: Session stays alive while you work, and ends honestly when it cannot

**Feature Branch**: `feat/CLEAN-72-jwt-token-refresh`

**Created**: 2026-09-08

**Status**: Draft — research complete; session model revised 2026-09-08 after reviewing the skyhunter reference implementation (research §3.1–3.2); ready for `/speckit-plan`

**Tracker**: [CLEAN-72](https://dreamvention.atlassian.net/browse/CLEAN-72)

**Research**: [`research.md`](./research.md) — the current-state audit this specification is built on, with file-level evidence and the option comparison.

**Input**: User description: "Я бы хотел изначально провести ресерч, касательно необходимости имплементировать рефреш механизм для токена. Флоу бага такой, у нас открыта сессия с агентом. Браузер неактивен некоторое время. JWT токен со своим временем жизни. Мы начинаем новую сессию и у нас сверху чата отображается alert что invalid токен. Как мы можем это корректно исправить?"

## Overview

A person signs in to a console, opens an agent chat, and leaves the tab. When they come back — an hour, a day, a week later — the chat greets them with a red box saying the token is invalid. Nothing renews the session token while they use the product, nothing notices when it dies, and when it does die every part of the console reacts differently: one part bounces to the login page, one paints the raw error into the chat, one quietly keeps chatting as an anonymous stranger with no history, and the admin chat sits "offline" until someone reloads the page.

The research answers the question that was asked: **yes, a renewal mechanism is needed**, and the shape is the one already proven in the team's skyhunter product: a **session** the browser holds but cannot read, which stays alive as long as the person keeps coming back, and a **short-lived access token** the console uses for every request and renews from that session without the person noticing — even after the access token itself has expired. Signing out ends the session for real. When the session cannot be renewed — they were away longer than the inactivity window, the session was revoked, their account was removed — the console says so once, in one place, and takes them back to the exact chat after they sign in again.

This holds for **both consoles**: the user console (`app`) where the bug was reported, and the admin console, where the same expiry leaves the live chat permanently disconnected. The public share-link chat is a different visitor path that already handles a dead console session on purpose, and it must keep working exactly as it does.

Out of scope, deliberately: multi-device session lists and "sign out everywhere", "remember me" choices, instant per-request revocation, and any change to the agent service, embed, or browser-extension token families.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A session I keep using never expires under me (Priority: P1)

An operator keeps the console open across the working week. They chat with agents daily, sometimes leaving the tab for hours or overnight. They are never asked to sign in again as long as they come back within the session lifetime, and they never see an authentication error in the middle of their work.

**Why this priority**: This is the failure the ticket reports and the one people hit most: a tab left open, then a dead session. Renewal while the product is in use removes the cause for everyone who returns within the lifetime, which is nearly everyone.

**Independent Test**: Sign in with the session lifetime shortened to minutes. Keep interacting past the original expiry moment. Every action succeeds, no login prompt appears, and the session's expiry has moved forward each time it was close to running out.

**Acceptance Scenarios**:

1. **Given** a signed-in operator whose access token is close to expiring, **When** they perform any action in the console (send a message, open a chat, upload a file), **Then** the action succeeds and a fresh access token is obtained without any prompt.
2. **Given** a tab that was hidden or in the background long enough for the access token to expire but for less than the inactivity window, **When** the person returns to it, **Then** the console obtains a fresh access token before their next action and nothing they do fails for authentication reasons.
3. **Given** an operator who opens the console fresh (new tab, reload) with a live session, **When** the console starts, **Then** it obtains an access token as part of start-up and the person lands where they were going, signed in.
4. **Given** every renewal, **When** it succeeds, **Then** the session's inactivity window is extended from that moment — the session ends only after the person has been away for the whole window, or when the absolute maximum is reached.
5. **Given** a tab left open and completely untouched for longer than the inactivity window, **When** the person returns, **Then** the session has lapsed normally (see User Story 2) — a renewal always requires the person to have been present.

---

### User Story 2 - When the session is gone, I am told once and returned to where I was (Priority: P1)

A person comes back to a chat after being away longer than the inactivity window, or after their session was ended from the server side. Instead of a red box quoting an internal error, the console shows one clear "your session has ended, sign in to continue" state. Signing in brings them straight back to the same agent chat they were looking at, with its history intact.

**Why this priority**: Renewal cannot cover every case. This story is the safety net for all of them and is what turns the reported bug from "confusing and broken" into "expected and quick". It is P1 together with Story 1 because either alone leaves the reported experience in place for part of the audience.

**Independent Test**: Sign in, then make the session invalid on the server side (let it expire, or change the signing secret). Return to an open chat and send a message. Exactly one session-ended state appears, no raw error text is shown anywhere, and after signing in the person is back in the same chat.

**Acceptance Scenarios**:

1. **Given** an operator on an agent chat whose session has expired, **When** they send a message, **Then** the message is not sent as an anonymous visitor, no raw error string appears in the chat, and the console presents the session-ended state.
2. **Given** the session-ended state, **When** the person signs in again, **Then** they land on the same chat they were on, with the same conversation history and the message they tried to send still available to resend.
3. **Given** an operator whose access token was signed with a secret the server no longer accepts but whose session is still live, **When** they return, **Then** the console obtains a fresh access token and they continue without noticing; if the session is also gone, they get the same session-ended experience as an expired session, and the platform's own records let a maintainer tell the causes apart.
6. **Given** a signed-in operator who signs out explicitly, **When** anyone later presents that browser's old session or access token, **Then** it is refused and no renewal is possible from it.
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

- Two tabs of the same console open at once share one session: renewal in one tab must not invalidate or confuse the other; each tab ends up with a working access token and neither is signed out.
- A renewal attempt races with the person's own action at the exact expiry moment: the action must either wait for the renewal or be retried once transparently — never fail with an authentication error.
- Several triggers ask for renewal at the same instant (timer, tab becoming visible, a rejected request): exactly one renewal happens and all of them share its result.
- Renewal is requested for a session that is already expired or revoked: it is refused, and the console goes to the session-ended state instead of looping on renewal attempts.
- The person is signed out explicitly: the session is ended on the server, no renewal happens afterwards in that browser, and any pending renewal result is discarded.
- The account behind a live session is removed or its role changes: renewal is refused, and the person sees the session-ended state rather than continuing with stale permissions.
- The server is unreachable during a renewal attempt: the console does not treat a network failure as an ended session; it keeps the current access token until it actually expires and retries renewal later.
- A message was sent with an expired access token in the old behaviour: it must no longer be delivered as an anonymous visitor; the console renews and resends, or shows the session-ended state with the message preserved for resend.
- A person signed in before this change, holding only an old long-lived access token and no session: they reach the session-ended state exactly once, then sign in normally.
- The session reaches its absolute maximum while the person is actively working: they are taken to the session-ended state at a moment that does not lose their unsent message.
- A local environment without a configured signing secret: the platform must not mint access tokens it cannot itself verify; start-up fails clearly or one shared fallback is used everywhere.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Signing in MUST establish two things: a **session** held by the browser in a form console code cannot read, and a short-lived **access token** the console uses for requests. The session has an inactivity window and an absolute maximum lifetime; the access token has a lifetime of minutes.
- **FR-002**: The platform MUST let a console obtain a fresh access token by presenting the session alone — without credentials and regardless of whether the previous access token has expired. Each successful renewal MUST extend the session's inactivity window from that moment and record when the session was last used.
- **FR-003**: Renewal MUST be refused when the session is missing, past its inactivity window or absolute maximum, revoked, or tied to an account that no longer exists. The refusal MUST carry a machine-readable reason a console can act on, and MUST be distinguishable in the platform's own logs.
- **FR-004**: Explicit sign-out MUST end the session on the server so that neither it nor any access token derived from it can be renewed afterwards, and MUST stop all renewal activity in that browser.
- **FR-005**: Each console MUST renew the access token on its own before it expires while the person is actively using the product, at console start-up, and when a hidden tab becomes visible again. Concurrent renewal triggers MUST collapse into one renewal. A completely untouched tab MUST NOT keep the session alive past its inactivity window.
- **FR-006**: Every request a console makes MUST carry the *current* access token, including live connections and direct uploads that today capture it once; a renewal MUST take effect for all of them without a page reload.
- **FR-007**: When the platform rejects an access token, the response MUST carry a machine-readable reason that lets a console distinguish "expired" from "invalid" from "none provided". A console MUST answer "expired" by renewing and retrying the request once, and "invalid" or a failed renewal by moving to the session-ended state.
- **FR-008**: The chat message path MUST NOT silently treat an expired or invalid access token as an anonymous visitor. A request that presents an access token that cannot be verified MUST be rejected as an authentication failure; a request that presents no access token at all keeps today's anonymous behaviour.
- **FR-009**: Each console MUST present a single session-ended state when a session cannot be renewed, regardless of how many requests failed. This state MUST use product copy, never the platform's internal error text.
- **FR-010**: Signing in from the session-ended state MUST return the person to the page and chat they were on, with conversation history preserved and any unsent message kept for resend.
- **FR-011**: The admin live chat connection MUST connect with the current access token, renew before connecting when the token is about to expire, and react to an authentication rejection by renewing and reconnecting once, then moving to the session-ended state.
- **FR-012**: The public share-link chat MUST keep its current behaviour: a dead console session in the same browser MUST NOT interrupt a visitor, redirect them, or show them the session-ended state.
- **FR-013**: Session lifetimes MUST NOT change the lifetimes of the platform's other credentials (agent service, embed, browser-extension, share-link); those are outside this feature.
- **FR-014**: The user console's user-facing copy for the session-ended state MUST follow the console's i18n process (source strings in the slice's English locale, generated Russian, keys in templates).

### Key Entities

- **Session**: the platform's record that a person signed in from a browser. Has a creation moment, an inactivity window that slides on every renewal, an absolute maximum, a last-used moment, and a revoked marker. Held by the browser as an unreadable credential. One session may be shared by several tabs of the same browser.
- **Access token**: the short-lived proof a console attaches to every request and live connection. Carries the identity, roles and the session it came from. Renewed from the session; never renewed from itself.
- **Session-ended state**: the one console-wide condition shown when a session cannot be used or renewed. Carries the return destination (page, agent, chat) so sign-in can restore it.
- **Rejection reason**: the platform's categorisation of why a credential was refused — missing, expired, invalid, or (for sessions) revoked — used by consoles to decide between renewing, ending the session, or ignoring the failure (share visitor).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who returns to the console at least once within the inactivity window is never asked to sign in again and never sees an authentication error — 0 forced re-logins in a test week of daily use with the access-token lifetime shortened to a minute and the inactivity window to hours.
- **SC-008**: After explicit sign-out, 100% of attempts to reuse that browser's previous session or access token are refused.
- **SC-002**: After the session has genuinely ended, 100% of test returns to an open chat show exactly one session-ended state and zero raw internal error strings, in both consoles.
- **SC-003**: After signing in from the session-ended state, the person is back on the same chat with its history in under 5 seconds and in one step (sign in — nothing else to click).
- **SC-004**: No message is ever delivered as an anonymous visitor on behalf of a signed-in person whose session expired: 0 anonymous chat channels created from requests that carried a console session, over the test period.
- **SC-005**: The admin live chat recovers from a renewal or a reconnect without a page reload in 100% of test runs, and shows the session-ended state within 10 seconds when the session cannot be renewed.
- **SC-006**: The public share-link chat behaves identically before and after this change in its existing acceptance scenarios (no regressions).
- **SC-007**: A maintainer can tell an "expired" rejection from an "invalid signature" rejection from the platform's logs alone, for 100% of rejections.

## Assumptions

- **Renewal shape**: server-side session in an unreadable browser credential plus a short-lived access token (option A in the research, in the shape already implemented in the team's skyhunter product — research §3.1) plus honest expiry handling (option C). The earlier "sliding renewal of the single token" recommendation (option B) is superseded; it was based on the assumption that the access token could not be separated from the session credential, which skyhunter disproves.
- **Lifetimes** (planning may adjust): access token 15 minutes; inactivity window 7 days, which is today's total lifetime turned into an inactivity limit; absolute maximum 30 days. The renewal threshold is a planning detail; the intent is "renew shortly before expiry whenever the person is present", not "renew on every request".
- **No session rotation on renewal**: the session credential stays the same across renewals so that tabs sharing it cannot race each other; only the access token changes. Rotation with reuse detection is not needed while the credential is unreadable by page code.
- **Revocation latency**: a revoked or removed account is refused at its next renewal, i.e. within one access-token lifetime; instant per-request revocation is out of scope.
- **"Actively using the product"** means the tab is visible and the person has interacted with it or the console is performing an action on their behalf; a hidden, idle tab does not renew.
- **Consoles and the platform share a site** in every deployed environment, so the session credential can be scoped strictly (same-site) without cross-site allowances; local development runs everything on one host.
- **Session-ended state UX**: an in-place, dismiss-free state with a sign-in action is preferred over a hard redirect that loses the page. The exact presentation (modal vs. full-page interstitial) is a design detail; the requirement is one state, product copy, and return-to-place.
- **Both consoles** are in scope for Stories 1 and 2; Story 3 is admin-only because only the admin has a live connection. The user console's chat transport stays request-based.
- **Other token families** (agent service token, embed token, browser-extension tokens, share-link secret) are untouched.
- **Environments**: production and staging have a configured signing secret; the local-environment concern is limited to making the fallback consistent or failing fast.
