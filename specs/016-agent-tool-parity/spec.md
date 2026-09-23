# Feature Specification: Agent tool parity — the agent can do everything the console can

**Feature Branch**: `feat/CLEAN-109-agent-tool-parity`

**Created**: 2026-09-22

**Status**: Draft — clarifications settled 2026-09-22; ready for `/speckit-plan`

**Tracker**: [CLEAN-109](https://dreamvention.atlassian.net/browse/CLEAN-109) — `[ADMIN][API]`, labels `admin`, `api`

**Input**: User description: "Я хочу обсудить и закрыть фундаментальную проблему философии нашего ранчера. Изначальная задумка была в полной автономности настройки платформы через чат с агентом, который имеет всевозможные тулзы и через чат делает всё что угодно в скоупе ранча — создаёт/редактирует/добавляет/управляет. Мы отошли от правильного паттерна: то, что настраивается через админку, не видно для агента, у которого нет нужных инструментов. Искоренить: (1) изучить текущий спектр возможностей админки и то, что покрывают тулзы, дописать недостающие; (2) кнопка Tools в чате — аккордеоны по топикам (например a2a), внутри название и описание каждого инструмента, клик вставляет лёгкий промт-шаблон в чат, максимальный UX; (3) правило в CLAUDE.md и в graft: любой новый модуль помимо тестов должен покрываться тулзами для агента."

## Overview

Ranch was designed around one idea: **the console is a window, the chat is the hands.** An operator should be able to open the Rancher chat, say "create a researcher agent on the Claude credential with the docs knowledge base, give it the A2A peer «billing» and restart it", and have it happen. Every screen in the admin console is, in that model, a convenience over something the agent could also do.

That model has drifted. Feature by feature, the console gained screens whose actions have no counterpart in the agent's tool list. Today the console can manage **19 kinds of things**; the agent has tools for **7 of them in full, 5 in part, and 7 not at all** (the audit below has the detail). An operator who asks the Rancher agent to "register the GitHub MCP server" or "add this URL to the docs knowledge base" gets "I can't do that from here" — not because the platform can't, but because nobody handed the agent the tool.

This feature closes the gap and makes sure it stays closed. Three parts:

1. **Parity.** Every capability the admin console exposes is reachable by the agent through a tool, with the same permission model the console applies. The audit in this document is the checklist; the work is done when every row reads "covered".
2. **A visible tool shelf.** A person in the chat should not have to guess what the agent can do. A **Tools** button beside the composer opens the agent's tool list grouped by topic; each tool shows its name and a plain-language description, and one click drops a ready-to-edit prompt into the composer. What the agent can do becomes something you can see and try, not something you discover by asking.
3. **A standing rule.** The project's working instructions (for people and for coding agents) state that a module is not finished until the agent has tools for what it does, the same way it is not finished without tests. The rule names where tools live, how they are grouped and described, and what the reviewer checks.

**In scope**: the audit and the tools that close it, on the API; the Tools panel in the admin console's two chat surfaces (the Rancher page and an agent's Chat tab); a read surface the console uses to learn an agent's current tool list; the rule in `CLAUDE.md` and the graft guidance; tests for every new tool.

**Out of scope, deliberately**: any change to the agent runtime image (tools are served by the API, as today); a Tools panel in the user console (`app`) or the public share page; tools for things the console itself cannot do; changing the permission model (a tool never lets a caller do what the console would refuse that same person); natural-language "macros" that chain several tools.

## The audit: what the console can do vs. what the agent can do

Read this table as the definition of "parity". "Console" is what an operator can do from the admin UI today. "Agent today" is what the agent has a tool for. "Gap" is what this feature adds. Names in the Gap column are indicative; the plan decides exact names, but every action listed must exist.

| # | Area (console section) | Console can | Agent today | Gap to close |
|---|---|---|---|---|
| 1 | **Agents** | list, view, create, edit (name, credential, knowledge, resources), promote/demote admin, restart, stop, start, delete, view live status and metrics, view pod env preview, view pod logs, view its MCP servers and "pending restart" state, capacity | list, get, create, update, set admin, restart, usage | stop, start, delete, status/metrics, env preview, logs (tail), MCP list + drift state, capacity |
| 2 | **Agent → Secrets** | list keys, set, delete, replace all | — | list, set, delete, replace |
| 3 | **Agent → Channels** | view and set delivery channels | — | get, set |
| 4 | **Agent → Share link** | view, create, regenerate, revoke | — | get, create, regenerate, revoke |
| 5 | **Agent → Workspace files** | list, read, write, delete, sync from pod, export | list, read, write | delete, sync, export |
| 6 | **Agent → A2A peers** | card, peers, candidates, preview, connect, import external, refresh, remove, delegations | all of it (operator set + agent self-service set + `ask_agent`) | none — this is the model to copy |
| 7 | **Agent → Paddock** | scenarios per agent, run evaluation, report | covered (see 15, 16) | none |
| 8 | **Templates** | list, view, create, edit, delete, set skills, **set MCP servers**, files list/read/write/upload, install from zip, install from git, export | list, get, update, set skills, files list/read/write | create, delete, set MCP servers, upload file, install (zip/git, with preview), export |
| 9 | **Skills** | list, view, create, edit, delete, import from URL, search curated repos and import, which agents use a skill, redeploy them | list, update, agents-of-skill, redeploy | get, create, delete, import from URL, search + import |
| 10 | **LLM credentials** | list, view, create, edit, delete, health-check, models catalogue, usage per credential | list | get, create, update, delete, health-check, models, usage |
| 11 | **MCP servers** | list, view, register, edit / enable / disable, delete, start OAuth | — | list, get, register, update, enable/disable, delete (OAuth start: expose the URL the person must open) |
| 12 | **Knowledge bases** | list, view, create, edit, delete, index, overview, graph + labels, ask, service status | ask (`query_knowledge`, only bases bound to the caller) | list, get, create, update, delete, index, overview, graph labels, status |
| 13 | **Knowledge → Sources** | list, add file/url/text, add many files, from sitemap, from archive, reindex one, re-extract, delete, imports in progress, export | — | list, add url/text, from sitemap, reindex, re-extract, delete, imports (file/archive upload: accept a path the agent can already read, see Assumptions) |
| 14 | **Settings** (organization, agent defaults, authentication, GitHub, Bridle, Knowledge, Rancher, MCP, Storage, Secrets) | list group, view one, set, delete | list, upsert | get one, delete; and the tool must *tell* the agent which groups and keys exist (today it has to guess) |
| 15 | **Paddock → Scenarios** | list, view, create, **generate from description**, edit, delete | list, get, per-agent, create, update, delete | generate |
| 16 | **Paddock → Evaluations** | run, list, view, report, logs, per-scenario result, trace, abort, rerun | run, list, get, report, abort, rerun | logs, per-scenario result, trace |
| 17 | **Users** | list, view, create, edit, set role, delete | — | list, get, create, update, set role, delete |
| 18 | **API keys** | list, create, revoke | — | list, create, revoke |
| 19 | **Chats** | list, view, messages, sync from runtime, summarize, feedback, export | — | list, get, messages, sync, summarize, export |
| 20 | **Usage** | per agent, per credential, overview | per agent | overview, per credential |
| 21 | **Browser sessions / Integrations** | sessions: list, open, reset, status, VNC URL, close; integrations: catalogue, accounts, login, import cookies, secret, delete | sessions: all | integrations: catalogue, accounts list/create/login/delete |
| 22 | **Ranch upgrade** | status, run upgrade | — | status, run |
| 23 | **Chat attachments** | — (chat only) | `query_attachment` | none |
| 24 | **Setup wizard, login, sessions page** | one-time / per-person | — | none — not agent work |

Two structural facts the plan must respect, because the audit found them and the panel depends on them:

- **Every built-in tool is served from one place** (the Ranch MCP server the API hosts) and the list a caller sees is filtered per caller: some tools are only listed for operator-role callers, some only for agent runtimes, one only when the agent has knowledge bound. The Tools panel must show the list *this* agent sees, not the union.
- **A pod reads its tool list once at boot.** A tool added after the agent started is not in its hands until restart. The console already knows this for MCP servers ("pending restart"); the Tools panel must say it too, or people will click a tool the agent cannot yet call.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Rancher agent can do what the console can (Priority: P1)

An operator opens the Rancher chat and asks for things they would otherwise click through: "register the MCP server at https://… with bearer auth and attach it to the researcher template", "add https://docs.example.com/sitemap.xml as sources of the docs knowledge base and index it", "create an API key named ci-deploy", "delete the test-bot agent". The agent does it, reports what it did, and the console shows the result on the next load. Where the console would ask for confirmation (deletes, revokes, role changes), the agent asks in the chat before acting.

**Why this priority**: This is the philosophy the ticket restores. Without parity, the panel in Story 2 would only advertise how little the agent can do.

**Independent Test**: For every row of the audit with a non-empty Gap, ask the Rancher agent to perform each listed action on a throwaway entity and verify in the console that it happened, then undo it through the agent. Ask a non-admin agent for an operator-only action and confirm it is refused with a message that names the console as the place to do it.

**Acceptance Scenarios**:

1. **Given** the audit table, **When** the feature ships, **Then** every action in the Gap column has a tool, and the agent's tool list for an operator-role caller includes each of them.
2. **Given** an operator asks the Rancher agent to register an MCP server and attach it to a template, **When** the agent finishes, **Then** the server is in the console's MCP list, attached to that template, and agents of that template show "pending restart".
3. **Given** an operator asks to delete an agent, revoke an API key, remove a user or change a role, **When** the agent has the tool, **Then** it states what will be removed and waits for a "yes" in the chat before calling the tool; the tool description carries that instruction so it holds for any runtime.
4. **Given** a caller without the operator role (a regular agent runtime), **When** it lists tools, **Then** operator-only tools are absent, and a direct call to one is refused with a message that explains who may do it.
5. **Given** an action the console performs with a secret (an LLM key, an integration secret, a bearer for an MCP server), **When** the agent performs it, **Then** the secret travels in the tool call and is never echoed back in the tool's result, the agent's reply, or the transcript.
6. **Given** every new tool, **When** the test suite runs, **Then** each tool has tests for the happy path, the refused-caller path, and the not-found path, in the style of the existing peer and knowledge tool tests.

---

### User Story 2 - See what the agent can do, and try it in one click (Priority: P1)

Beside the chat composer there is a **Tools** button. It opens a panel listing the agent's tools grouped by topic — *Agents, Templates, Skills, LLM credentials, MCP servers, Knowledge, Settings, Peers (A2A), Paddock, Users & keys, Chats & usage, Browser, Attachments* — as collapsible accordions. Expanding a topic shows each tool as a row: a short human title, the tool's technical name in smaller type, and a one-line description that says what it does in plain words. A search box filters across all topics as you type. Clicking a tool row inserts a **prompt template** into the composer — a short, natural sentence with obvious placeholders ("Restart the agent «…»", "Add the URL … to the knowledge base «…» and index it") — puts the cursor on the first placeholder, and closes the panel; the person edits and sends. Tools the running agent does not yet have (added since it booted) are shown greyed with "after restart" and a restart shortcut, so nobody sends a prompt the agent cannot act on.

**Why this priority**: The ticket asks for "maximum UX": the value of parity is invisible if a person has to guess the vocabulary. The panel turns the tool list into a menu.

**Independent Test**: Open the Rancher chat, press Tools, expand *MCP servers*, click "Register an MCP server"; confirm the composer holds the template with the cursor on the first placeholder and the panel is closed. Edit the template freely and send; confirm nothing constrained the edit. Type "knowledge" in the panel's search and confirm only knowledge tools remain. Attach a new MCP server to the agent's template without restarting, reopen Tools and confirm that group is marked "after restart" with a restart button that works.

**Acceptance Scenarios**:

1. **Given** the Rancher chat or an agent's Chat tab, **When** the person presses Tools, **Then** a panel opens listing exactly the tools that agent's runtime would receive (per-caller filtering applied), grouped by topic, each with title, technical name and description; topics with no tools are not shown.
2. **Given** the panel is open, **When** the person clicks a tool, **Then** its prompt template is inserted at the composer's cursor (appended with a space if the composer already has text), the first placeholder is selected, the panel closes, and nothing is sent.
3. **Given** the panel is open, **When** the person types in the search box, **Then** rows are filtered by title, technical name and description across all topics, with matching topics expanded; clearing the box restores the accordion state.
4. **Given** a tool was added after the agent's pod started, **When** the panel is opened, **Then** the tool (or its whole topic) is visibly marked "after restart", its click still inserts the template but the row explains the agent will not act until restarted, and a restart control is offered that reuses the existing restart flow.
5. **Given** the agent's tool list cannot be loaded (agent stopped, API error), **When** the panel is opened, **Then** it says so in one line and offers retry; the composer keeps working.
6. **Given** the panel is open on a narrow window, **When** it renders, **Then** it is usable at phone width (a sheet or drawer, not a hover popover), and keyboard users can open it, move between rows and pick one without a mouse.
7. **Given** the person has never used the panel, **When** they open the chat for the first time, **Then** the Tools button is discoverable next to the attach button, with a tooltip, and needs no onboarding.

---

### User Story 3 - The rule that keeps parity (Priority: P2)

A developer (or a coding agent) adds a new capability to the console. The project instructions tell them, in the same place that tells them to write tests and to create a Jira issue, that **the module is not done until the agent has tools for what it does**: where tool files live, that each tool declares a topic and a prompt template, how permissions are expressed, that every tool ships with tests, and that the PR reviewer checks it. The graft guidance carries the same rule, so a coding agent that starts from graft reads it before it reads the code.

**Why this priority**: Without this, the audit will be out of date in a month. It is P2 only because it depends on the vocabulary Story 1 and 2 establish (topics, templates, gating).

**Independent Test**: Read `CLAUDE.md` and the graft guidance as a newcomer: both state the rule, name the tool location and the required metadata, and point at one existing module as the reference example. Start a fresh coding-agent session in the repo and ask "I added a new console feature, what else must I ship?" — the answer names agent tools and tests without further prompting.

**Acceptance Scenarios**:

1. **Given** `CLAUDE.md`, **When** read, **Then** it has a short section stating the parity rule, the definition of done for a module (tests + tools + topic + template + permission check), the reference module, and the one-line check for reviewers.
2. **Given** the graft guidance the coding agents load, **When** read, **Then** it carries the same rule (or a pointer to the canonical doc), and it survives a `graft init` / `graft build` (see Assumptions for how).
3. **Given** a new module is added without tools, **When** a reviewer follows the checklist, **Then** the omission is caught before merge.

---

### Edge Cases

- **A tool the agent has but the console does not show** (e.g. `query_attachment`): the panel still lists it; parity is one-directional (console ⊆ agent), never a reason to hide a tool.
- **Two chats open for two agents**: each panel shows its own agent's list; switching agents does not leak the previous list.
- **The agent is the Rancher admin but the person is not an owner**: the panel shows what the *agent* can do; whether the person may ask for it is a chat-level question, not the panel's. Nothing in the panel reveals secret values (auth values of MCP servers, credential keys).
- **A tool call that the console would have confirmed** (delete, revoke, role change) arrives without a prior "yes" in the chat: the tool executes (the API cannot see the chat); the safeguard is the tool description's instruction plus the agent's reply. The plan may add a `confirm: true` argument to destructive tools so a runtime cannot call them by accident.
- **A file upload capability** (source file, template file upload, template zip install): the agent has no file picker. The tool accepts content it can already produce (text, a URL, a path inside its own workspace); binary upload from the person's machine stays a console action and the panel says so.
- **Prompt template placeholders**: shown as «…» in the composer; sending with a placeholder left in is allowed (the agent will ask), but the composer highlights the remaining placeholder.
- **A topic with one tool**: still an accordion, for consistency; no special case.
- **Runtime pods that never reload their tool list** and an operator who never restarts: the "after restart" marker stays until the pod restarts; it does not time out.
- **The tool list endpoint is called by a share-page visitor or a non-admin**: refused; the panel only exists in the admin console.

## Requirements *(mandatory)*

### Functional Requirements

**Parity (API)**

- **FR-001**: Every action listed in the Gap column of the audit MUST be available as an agent tool by the end of this feature; the audit table in this document is the acceptance checklist.
- **FR-002**: A tool MUST apply the same authorization the console applies to that action: operator-only actions are listed only for operator-role callers and refuse others with a message naming who may perform them; agent-self actions are listed only for agent runtimes.
- **FR-003**: Tools that remove or revoke (agents, templates, skills, credentials, MCP servers, knowledge bases, sources, users, API keys, share links, peers, files) MUST carry, in their description, the instruction to confirm with the person first, and MUST require an explicit confirmation argument so an accidental call cannot delete.
- **FR-004**: No tool result, error, or listing MUST contain a secret value (LLM keys, MCP bearer tokens, integration secrets, agent secret values); listings show names and metadata only, and set-operations acknowledge without echoing the value.
- **FR-005**: Each tool MUST declare a **topic** (the accordion it belongs to), a **human title**, a **description** written for a person reading the panel, and a **prompt template** with «…» placeholders; the system MUST reject registering a tool without these at startup, so the rule in Story 3 is enforced, not advised.
- **FR-006**: The tool for reading settings MUST tell the agent which groups and keys exist and what each means, so the agent does not have to guess names to change a setting.
- **FR-007**: Every new tool MUST have tests covering success, refused caller, and missing entity.
- **FR-008**: Tools MUST reuse the same domain services the console's endpoints use, so a change to a capability reaches both surfaces at once; a tool MUST NOT reimplement a console rule.

**Tool shelf (console)**

- **FR-009**: The admin console MUST be able to read, for a given agent, the tool list that agent's runtime would receive: per tool its name, title, description, topic, prompt template, and whether the running pod already has it.
- **FR-010**: Both admin chat surfaces (the Rancher page chat and the agent Chat tab) MUST show a **Tools** button beside the composer's attach button, with a tooltip.
- **FR-011**: The Tools panel MUST group tools by topic as collapsible accordions, show title, technical name and description per tool, hide empty topics, and remember which accordions were open within the session.
- **FR-012**: The panel MUST offer a search field that filters across all topics by title, technical name and description.
- **FR-013**: Clicking a tool MUST insert its prompt template into the composer at the cursor, select the first placeholder, close the panel, and not send.
- **FR-014**: Tools the running pod does not yet have MUST be visibly marked "after restart" with an explanation and a restart control that reuses the existing restart flow; the marker MUST clear once the pod restarts.
- **FR-015**: The panel MUST handle "list unavailable" (agent stopped, request failed) with a one-line message and a retry, without disabling the composer.
- **FR-016**: The panel MUST work at phone width and with a keyboard alone.
- **FR-017**: The panel MUST NOT display secret values or connection credentials of any kind.

**Rule (repo guidance)**

- **FR-018**: `CLAUDE.md` MUST state the parity rule as part of the definition of done, name where tools live, the required metadata (topic, title, description, template, authorization, tests), a reference module, and a reviewer check.
- **FR-019**: The graft guidance loaded by coding agents MUST carry the same rule or a pointer to the canonical document, in a form that survives `graft init` and `graft build`.
- **FR-020**: The PR template or review checklist used in this repo MUST include the line "console capability added → agent tool added, with tests".

### Key Entities

- **Tool**: one action the agent can perform; has a technical name, a title, a description, a topic, a prompt template, an authorization rule (operator / agent-self / everyone), and tests. Served to runtimes by the API.
- **Topic**: a named group of tools matching a console section (Agents, Templates, …); the accordion in the panel.
- **Prompt template**: a short natural-language sentence with «…» placeholders that a newcomer can send to reach this tool; belongs to exactly one tool. It is a starter, not a form: it only helps a person come up with an example, the person reshapes it freely, and the agent still decides which tool to call.
- **Agent tool list**: the set of tools a specific agent's runtime receives, after per-caller filtering, with a per-tool "present in running pod / after restart" flag.
- **Parity audit**: the table in this spec; every console capability mapped to its tool; the checklist reviewers and future work use.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of console capabilities in the audit (rows 1–22) have a corresponding agent tool; the table reads "covered" in every Gap cell at the end of the feature.
- **SC-002**: An operator can complete each of these from the Rancher chat alone, without opening any other console page: register an MCP server and attach it to a template; add a URL source to a knowledge base and index it; create an LLM credential and health-check it; create a user and set their role; create and revoke an API key; delete a throwaway agent with confirmation.
- **SC-003**: From opening the chat, a person can find a tool by name or description and have its template in the composer in under 10 seconds and at most 3 interactions (open, search or expand, click).
- **SC-004**: Zero secret values appear in tool results, agent replies, or transcripts, verified by a test that scans every tool's output for the secret it was given.
- **SC-005**: Every new tool has tests; the API test suite passes; the console typecheck passes.
- **SC-006**: A newcomer reading `CLAUDE.md` or the graft guidance names "agent tools" as part of a module's definition of done without prompting.
- **SC-007**: The "after restart" marker is correct in both directions: present when a tool was added after the pod started, absent after restart.

## Assumptions

- **Surfaces**: the Tools panel ships in the admin console only (Rancher page chat and agent Chat tab). The user console (`app`) chat and the share page are not in scope; their agents keep their tools, only the shelf is absent.
- **Where the rule lives for graft**: graft rewrites its skill file and Cursor rule on `graft init`, so the canonical text lives in a project-owned document (`docs/agent-tools.md`), `CLAUDE.md` states the rule and links it, and the graft skill and Cursor rule get a short project-owned pointer block that is re-added if graft overwrites it. The plan may find graft supports a preserved section and use that instead.
- **File uploads**: tools that add binary files (source files, template zip, template file upload) accept a path inside the agent's own workspace or a URL, never a browser upload; the console remains the place for uploading from a person's machine, and the panel says so in the tool description.
- **Confirmation**: because the API cannot see the chat, "ask before deleting" is enforced by a required confirmation argument plus the description; the runtime's own judgement decides when to ask. No new chat-level confirmation UI is added.
- **Topics** mirror console sections one-to-one; the plan may merge small sections (Users + API keys, Chats + Usage) when a topic would hold fewer than three tools.
- **Prompt templates** are English, like the rest of the admin console (`admin/` is English-only per project rules).
- **Existing tools** keep their names; they gain topic, title and template metadata but no behavioural change, so the runtimes' current prompts still work.
- **Authorization vocabulary** already exists (operator-role gating, agent-self gating, per-caller listing); new tools reuse it rather than inventing another.
- **Restart awareness** reuses the existing "MCP configuration drift" detection; a tool added to the built-in server after pod start counts as drift of that server.

## Decisions (clarifications settled 2026-09-22)

1. **Parity extent for sensitive areas — full.** Users, API keys, LLM credential creation with keys, storage/secrets settings and every delete/revoke/role change get tools, listed only for operator-role callers. Destructive tools require an explicit `confirm: true` argument: the description tells the agent to call only after the person said yes in the chat; a call without it does nothing and returns what would be removed and a request to confirm. Secret values travel in, never out (FR-004).
2. **Tools panel source of truth — live per-agent list.** The console reads the list that this agent's runtime would receive: built-in tools after per-caller filtering, plus each external MCP server the agent is attached to as its own group, with the "after restart" flag per entry. A static catalogue is explicitly rejected.
3. **Legacy tool names — unchanged.** Only seven of the fifty-nine names deviate from the verb-noun scheme (the six `browser_session_*` tools and `agent_usage`); the panel shows a human title first and the technical name in small type, so the deviation is invisible to people. Existing tools gain topic, title, description and template metadata and keep their names; no aliases, no runtime restarts forced by this feature.
4. **Prompt templates are starters, not forms.** A template exists only to help a newcomer come up with an example message for that tool. It inserts a piece of text; the person reshapes it freely; nothing about it is binding for the person or the agent.
