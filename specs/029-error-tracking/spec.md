# Feature Specification: Error Tracking for API, Admin and App

**Feature Branch**: `feat/CLEAN-218-error-tracking`

**Created**: 2026-11-11

**Status**: Draft

**Ticket**: [CLEAN-218](https://dreamvention.atlassian.net/browse/CLEAN-218)

**Input**: User description: "Implement Sentry for the three projects inside one repository — api / admin / app. The idea is one common slice/class that works against different DSNs. Take the working logic from the main-site repository: Sentry is worked out there, including how errors are made specific, so they can be handled well. The tracker is GlitchTip; a project exists for each of Ranch Api, Ranch App and Ranch Admin."

## Background

A failure in Ranch is visible today in two places: the API pod's log, and the
browser console of the person it happened to. Nobody on the team is told. A
user who hits a broken screen either reports it by hand or does not report it
at all, and a failure in background work (a channel transport, a scheduled job)
has no user to report it.

The team runs a GlitchTip instance (a Sentry-compatible error tracker) and has
created one project in it for each of the three Ranch projects. The sister
product, main-site, already reports there with a rule set that keeps the feed
useful: production only, expected errors left out, every event labelled with
its status and error code, private data removed before it leaves. This feature
brings the same rule set to Ranch.

The three projects differ only in *where* they report. *What* they report, and
what they strip out, is one set of rules.

**Who reports.** Only the Ranch production installation deployed from this
repository. Ranch has no dev or stage environment — production is the only
deployed one — and local development never reports. The Mazda installation,
built from a fork that merges this repository in, reports nothing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A failure in the API reaches the team (Priority: P1)

A developer on the team learns that the API failed without anyone telling them.
The failure may have happened while answering a request, or in work nobody was
waiting on: a channel transport, a background job, a crash of the process
itself. In the tracker they see what failed, where in the code, in which
release, on which installation, and for a request also which operation and
which signed-in user (as an opaque id) triggered it.

**Why this priority**: The API is where data is changed and where background
work runs with no user watching. A failure there that nobody sees is the most
expensive kind.

**Independent Test**: On a production-mode API with a destination configured,
force one failure inside a request and one outside any request. Both appear in
the Ranch Api project within a minute, each with release, installation and
stack trace.

**Acceptance Scenarios**:

1. **Given** a production API with a destination configured, **When** a request fails with an unexpected server error, **Then** one event appears in the API project carrying the operation, the status, the release and the installation.
2. **Given** the same API, **When** background work fails with no request in flight, **Then** an event appears in the API project, marked as not belonging to a request.
3. **Given** the same API, **When** a request is refused for an expected reason (not signed in, no permission, invalid input, not found), **Then** no event is sent.
4. **Given** the tracker is unreachable, **When** a request fails, **Then** the caller receives the same response, as fast as it would have otherwise, and the API keeps serving.

---

### User Story 2 - A failure in either console reaches the team (Priority: P1)

A developer learns that a screen in the admin console or the app console broke
for somebody. The event says which console, which screen, which release, and
what the code was doing. The same failure in admin and in app is handled by the
same rules; the two only report to different projects.

**Why this priority**: A broken screen is what the customer actually sees, and
today it leaves no trace outside their browser.

**Independent Test**: On a production build of each console with its
destination configured, trigger an unexpected failure in a screen. The event
appears in that console's project and not in the other's.

**Acceptance Scenarios**:

1. **Given** a production admin console with a destination configured, **When** a screen throws an unexpected error, **Then** one event appears in the Admin project with the screen and the release.
2. **Given** a production app console, **When** the same kind of failure happens, **Then** the event appears in the App project, with the same labels, decided by the same rules.
3. **Given** either console, **When** the API answers with a server failure, **Then** the console reports it, labelled with the status and the error code the API returned.
4. **Given** either console, **When** the user's session has expired, or the API returns an expected refusal that the console shows to the user as a message, **Then** no event is sent.

---

### User Story 3 - Nothing private leaves the product (Priority: P1)

Ranch carries things that must not end up in a third system: passwords, session
tokens, model-provider keys, email addresses, the text of conversations with
agents, the contents of files. A person responsible for the installation can
say with confidence that an error event contains none of them, whatever the
failing code happened to have in hand.

**Why this priority**: This is a condition of shipping the first two stories,
not a later refinement. A tracker that receives one secret has to be treated as
compromised.

**Independent Test**: Force failures in code paths that handle a login, a chat
message, a file upload and a stored credential. Inspect the resulting events:
every sensitive value is absent or replaced by a filtered marker.

**Acceptance Scenarios**:

1. **Given** a request that carries a session token and fails, **When** the event is recorded, **Then** the token and any cookie are filtered out of it.
2. **Given** a failure while handling a chat message or a file, **When** the event is recorded, **Then** it contains no message text and no file contents.
3. **Given** a failure for a signed-in user, **When** the event is recorded, **Then** the user is identified by an opaque id only — no email, no name, no network address.
4. **Given** an address that carries a token or other sensitive value as a parameter, **When** the event is recorded, **Then** that value is filtered and the rest of the address is kept.

---

### User Story 4 - The feed contains only what someone should act on (Priority: P2)

A developer opening the tracker sees failures of the product, not the ordinary
friction of using it. A wrong password, an expired session, a validation
message, a request the user cancelled, a laptop that went offline — none of
these are there. What is there is labelled well enough to sort: by project, by
status, by error code, by release.

**Why this priority**: A feed that is mostly noise is ignored within a week,
and then the real failures in it are ignored too. This is the part of main-site's
setup that makes it usable.

**Independent Test**: Run a scripted session that deliberately produces every
kind of expected error; the tracker receives nothing. Then produce one server
failure; the tracker receives exactly one event, with its labels.

**Acceptance Scenarios**:

1. **Given** a known application error with a status below the server-failure range, **When** it occurs in any project, **Then** it is not reported.
2. **Given** a known application error in the server-failure range, **When** it occurs, **Then** it is reported with its status and error code as labels and its title as detail.
3. **Given** an error that is not a known application error, **When** it occurs, **Then** it is reported.
4. **Given** local development, in any of the three projects, **When** any error occurs, **Then** nothing is sent, including errors the tracker library would have picked up by itself.
5. **Given** the same failure happening many times, **When** a developer opens the tracker, **Then** they see one issue with a count, not one issue per occurrence.

---

### User Story 5 - Only the Ranch production reports; every other build stays silent (Priority: P2)

The team collects errors from one place: the Ranch production deployed from
this repository. The same code also runs elsewhere — the Mazda installation is
built from a fork that regularly merges this repository in — and from there the
team receives nothing. Reporting is therefore switched on by the configuration
of the Ranch production alone. A build that sets nothing reports nothing, and a
merge of this code into the fork cannot switch reporting on there, because no
address travels with the source.

**Why this priority**: Without this, the next catch-up merge into the Mazda
fork sends a customer's failures — and whatever context comes with them — to
our tracker.

**Independent Test**: Deploy with no destination configured: nothing is sent
and nothing fails. Deploy the Ranch production with its destinations: events
arrive there, labelled with that installation's name.

**Acceptance Scenarios**:

1. **Given** an installation with no destination configured for a project, **When** that project fails, **Then** nothing is sent and the project behaves exactly as it does today.
2. **Given** a destination left at a placeholder value, **When** the project starts, **Then** reporting is off, the same as if it were empty.
3. **Given** the Mazda fork after it has merged this feature in, with no destination configured there, **When** any of its three projects fails, **Then** nothing is sent to any tracker.
4. **Given** any event in the tracker, **When** a developer looks at it, **Then** it names the installation it came from, so an event from an unexpected source is recognisable at once.
5. **Given** a repository checkout, **When** it is searched, **Then** it contains no reporting destination of any real installation.

---

### User Story 6 - A console stack trace points at the real source (Priority: P3)

A developer reading a console event sees the file and line they would open in
the editor, not a position in a compressed bundle. The event names the release
it came from, so "is this fixed already?" has an answer.

**Why this priority**: The earlier stories already tell the team that
something failed and roughly where. This one shortens the time from seeing an
event to opening the right file. It can ship after the rest.

**Independent Test**: Release a console build, force a failure, open the event:
the top frame names an original source file and line that exist in the
repository at that release.

**Acceptance Scenarios**:

1. **Given** a released console build, **When** a failure is reported, **Then** its stack trace shows original file names and line numbers.
2. **Given** a build made without the credential that publishes this mapping, **When** the build runs, **Then** it succeeds, and reporting still works with unmapped traces.
3. **Given** any event from any project, **When** a developer opens it, **Then** it carries the product release version it was built from.

---

### Edge Cases

- **Tracker down or slow.** Reporting never delays a response, never surfaces an error to a user, and never takes a process down. Events that cannot be delivered are dropped.
- **Reporting itself fails.** A failure while building or filtering an event is swallowed; it must not replace or mask the original error, and must not cause a second report.
- **Failure before configuration is read.** A project that fails during startup, before it knows its destination, behaves as it does today.
- **A storm of the same error.** A failure repeating on every request or every render is grouped into one issue; the volume sent is bounded so one bug cannot flood the tracker or the network.
- **The user's own environment.** A console request that fails because the user is offline, navigated away, or cancelled it is not a product failure and is not reported.
- **A stale console tab after a release.** A tab still running the previous release that fails to load a part of the console that no longer exists is a known, expected class; it is either not reported or reported under one recognisable label, never as a fresh unknown error each time.
- **The same failure seen twice.** A server failure is reported by the API and, when a console was waiting on it, by that console as well. The two events are in different projects and say different things (what broke; which screen it broke). This duplication is accepted.
- **Deliberately thrown application errors in the API.** An error the API raises on purpose with a status below the server-failure range is the API working correctly, and is not reported.
- **A sensitive value under an unexpected name.** Filtering by field name catches the known names; message bodies and file contents are kept out by not attaching request and response bodies at all, rather than by trying to recognise them.

## Requirements *(mandatory)*

### Functional Requirements

**Coverage**

- **FR-001**: The API MUST report unexpected failures that occur while handling a request.
- **FR-002**: The API MUST report failures that occur outside any request — background work, channel transports, unhandled failures of the process — and mark them as such.
- **FR-003**: The admin console and the app console MUST each report unexpected failures in their screens, wherever in the console's lifecycle they occur.
- **FR-004**: Each of the three projects MUST report to its own, separately configured destination. An event from one project MUST NOT arrive in another project's destination.

**One rule set**

- **FR-005**: The rules that decide whether an error is reported, how it is labelled, and what is filtered out of it MUST be defined once and behave identically in all three projects. The projects MAY differ only in configuration and in the labels that are specific to them (operation for the API, screen for a console).
- **FR-006**: A change to a reporting rule MUST NOT be able to land in one project and silently not in the others. The admin and app consoles in particular MUST be verifiably the same.

**What is reported**

- **FR-007**: A known application error — one that carries a status and an error code — MUST be reported only when its status is in the server-failure range.
- **FR-008**: A "not signed in" error MUST never be reported, in any project.
- **FR-009**: An error the product shows to the user as a message, with a status below the server-failure range, MUST NOT be reported.
- **FR-010**: An error that is not a known application error MUST be reported.
- **FR-011**: Failures caused by the user's own environment — a lost connection, a cancelled or abandoned request — MUST NOT be reported.
- **FR-012**: Reporting MUST be off in local development in all three projects. This includes errors the tracker library collects without being asked: with reporting off, nothing is sent by any path.
- **FR-013**: Reporting MUST be off when a project's destination is empty or a placeholder, with no error and no change in the project's behaviour.

**How an event is labelled**

- **FR-014**: Every event MUST carry: the project it came from, the installation, and the product release version. The environment is always production — there is no other deployed environment — so it is recorded as such and is not something a developer has to filter by.
- **FR-015**: An event for a known application error MUST carry its status and its error code as labels a developer can filter by, and its title as detail.
- **FR-016**: An API event for a request MUST identify the operation that failed. A console event MUST identify the screen.
- **FR-017**: Where a failure belongs to a signed-in user, the event MUST carry that user's opaque id and nothing else about them. Where it belongs to a specific agent, the event SHOULD carry that agent's id.
- **FR-018**: Occurrences of the same failure MUST be grouped as one issue.

**What never leaves**

- **FR-019**: Passwords, session tokens, authorization headers, cookies, stored credentials and keys, email addresses and phone numbers MUST be filtered out of every event, wherever in the event they appear — headers, addresses, attached context, extra detail.
- **FR-020**: Events MUST NOT contain the text of chat messages, the contents of files, or the bodies of requests and responses.
- **FR-021**: Events MUST NOT contain a user's email, name or network address. Sending personal data by default MUST be switched off rather than relied on to be filtered afterwards.
- **FR-022**: Filtering MUST apply to every event before it leaves the project, including events collected automatically.

**Safety of the product**

- **FR-023**: Reporting MUST NOT change what a user sees or what a caller receives, and MUST NOT add a noticeable wait to any response or screen.
- **FR-024**: A failure of the tracker, or of reporting itself, MUST NOT stop a request, a screen, or a process, and MUST NOT hide the original error from the existing logs.
- **FR-025**: The existing behaviour on an error — the message shown to the user, the redirect to sign in, the log line — MUST stay as it is. Reporting is added beside it.

**Installations and configuration**

- **FR-026**: The destination of each project MUST come from the installation's configuration. No real destination is committed to the repository, so a fork or another build of this code reports nothing unless its own operator configures it.
- **FR-027**: Every configuration value this feature introduces MUST be documented where an operator sets up an installation, with what it does and that leaving it empty turns reporting off.
- **FR-028**: Any credential used to publish source mapping MUST exist only where builds run. It MUST NOT be present in a running console or reachable from a browser.

**Readable traces**

- **FR-029**: Stack traces of console events from a released build MUST resolve to original source files and lines.
- **FR-030**: A build without the publishing credential MUST succeed and MUST still report, with unresolved traces.

**Scope of collection**

- **FR-031**: Only errors are collected. Performance tracing, session tracking and session recording MUST be off.

### Key Entities

- **Error event**: One reported failure. Carries what failed and where in the code, plus its labels: project, installation, release, and — when known — status, error code, operation or screen, user id, agent id.
- **Reporting destination**: Where one project of one installation sends its events. Three per installation, each independently set or empty. Not a secret for the consoles, where it is visible to any browser by necessity; not committed to the repository either.
- **Reporting rules**: The single definition of what is reported, how it is labelled and what is filtered. Shared by all three projects.
- **Known application error**: An error the product raised or received in its own format, with a status and an error code. Everything else is an unknown error.
- **Installation**: One deployment of Ranch, run by one organisation. Decides its own destinations and is named on every event it sends.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A forced failure in each of the three projects appears in that project's place in the tracker within 1 minute, and in no other project's.
- **SC-002**: A scripted session producing every expected error — wrong password, expired session, missing permission, invalid input, not found, cancelled request — results in zero events.
- **SC-003**: A full local development session across all three projects, including deliberately thrown errors, results in zero events.
- **SC-004**: 100% of events carry project, installation and release; 100% of events for known application errors also carry status and error code.
- **SC-005**: In a review of events forced through login, chat, file and credential code paths, zero contain a password, token, key, email address, chat text or file content.
- **SC-006**: With the tracker unreachable, every user-facing flow completes with the same result as with it reachable, and no response or screen is slower by an amount a user would notice.
- **SC-007**: An installation with no destination configured sends zero events and starts, runs and builds with no warning that requires action.
- **SC-008**: For every console event from a released build, a developer reaches the failing source line from the event without consulting the built bundle.
- **SC-009**: The repository contains zero real reporting destinations and zero publishing credentials.
- **SC-010**: One repeating failure produces one issue in the tracker, regardless of how many times it occurs.
- **SC-011**: After this feature reaches the Mazda fork through a catch-up merge, zero events from that installation arrive in the tracker.

## Assumptions

- **Errors only.** GlitchTip's setup page suggests sampling 1% of transactions for performance tracing. main-site turns tracing off and removes it from the bundle; this feature follows main-site. Tracing can be a later, separate decision.
- **The tracker and its three projects exist.** GlitchTip is already running and the Ranch Api, Ranch App and Ranch Admin projects have been created. Creating projects, members and alert rules in the tracker is done there, not by this feature.
- **A reporting destination is not a credential.** A console's destination is delivered to every browser by design, so it is public the moment it deploys; it identifies where to send, it does not grant access to read. It is still kept out of the repository because it is per-installation, not because it is secret. The credential that publishes source mapping *is* a secret and is handled as one.
- **One source of events.** The team collects from the Ranch production deployed from this repository and from nowhere else. There is no dev or stage environment to configure, label or tell apart. The Mazda installation is not a source: its fork receives this code through catch-up merges, and stays silent because nothing is configured there. Switching reporting on for Mazda, to their tracker or ours, would be a separate decision and a separate ticket.
- **Verification uses a production-mode run.** Since local development never reports, checking the feature means running a production build with a destination set. There is no development-mode override.
- **The agent runtime is out of scope.** Failures inside an agent's own process are a different product surface with different privacy questions. Only `api`, `admin` and `app` are covered. The CLI is out of scope as well.
- **No user-facing change.** No screen, message or setting is added to either console, so there is no new copy to translate and no new console capability for the Ranch agent to mirror with a tool.
- **Both consoles change together.** The error handling this feature attaches to lives in a slice that exists in both consoles; the work is not finished in one until the other matches.
- **Volume is small.** The tracker's default handling of bursts and its retention are adequate for Ranch's traffic; no extra quota or retention policy is specified.
- **Release version** means the product version the release pipeline already tags; no new versioning scheme is introduced.
