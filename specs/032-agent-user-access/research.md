# Research: Agent access by role

Phase 0 of [plan.md](./plan.md). Each entry is a decision the plan rests on,
with the fact in the code that forced it. Paths are from the repository root.

## R1. Where the lists live

**Decision**: a new API sub-slice `api/src/slices/user/agentAccess/` with two
models (see [data-model.md](./data-model.md)): one row per account
(`UserAgentAccess`) and one row per account and agent (`UserAgentAccessEntry`)
whose primary key is `(userId, agentId)` and which carries the list it is on.

**Rationale**: "an agent is never in both lists" (FR-004) and "at most once in
a list" (FR-005) then hold by construction: there is one row per account and
agent, so moving an agent is an update of one column, and two simultaneous
edits cannot produce a second row. The entry has a foreign key to `Agent` with
`ON DELETE CASCADE`, as `AgentLimit` has
(`api/src/slices/agent/limit/agentLimit.prisma`), so a deleted agent leaves no
entry behind. `userId` is a bare column: `User` has no relations and the repo
convention is no foreign key to it (`api/src/slices/user/session/session.prisma`),
so user deletion cleans up explicitly.

**Alternatives considered**: two array columns on `User` (a collision is then
a matter of application discipline, and a deleted agent needs a sweep); two
tables, one per list (the database can no longer refuse the same agent in
both).

## R2. "Empty allowed list means everything", and the deletion exception

**Decision**: the account row stores `limited`. The rule is
`reach = not denied AND (not limited OR allowed)`. `limited` becomes true with
the first allowed entry and false only when a person removes the last one and
confirms (FR-021). "Marked for review" is derived, not stored:
`limited AND no allowed entries`.

**Rationale**: FR-006. The cascade of R1 can remove the last allowed entry; if
emptiness alone meant "everything", deleting an agent would open every other
agent to that account. With `limited` kept, the account reaches nothing and
shows up for review. For every state a person can create, `limited` equals
"the allowed list is not empty", so the rule the feature description states
still reads true in the console.

**Alternatives considered**: block deletion of an agent that is someone's last
allowed entry (rejected in clarification); a stored `needsReview` flag (a
second fact to keep in step with the first).

## R3. Identity and freshness

**Fact**: `JwtAuthGuard` is global and stateless; it puts the token payload on
`req.user` and never reads the user row
(`api/src/slices/user/auth/guards/jwtAuth.guard.ts`). `roles` in the token is
refreshed every 15 minutes. A person's `sub` is the user id; an agent
runtime's is `agent:<id>`; embed tokens carry `typ: 'embed'`.

**Decision**: lists are read from the database on every request that needs
them: one indexed query by `userId`. The role still comes from the token.

**Rationale**: FR-010 and SC-006 ask for an access change to apply to the next
action. A query by primary-key prefix over tens of rows costs well under a
millisecond; a cache would add an invalidation path for nothing. Role
staleness of up to 15 minutes exists today and is not widened by this feature;
the lists themselves are never stale.

**Who is subject to the lists**: a caller whose token is a console token
(`typ` absent), whose `sub` does not start with `agent:`, and whose role is
Admin or User. Owner, agent runtimes, embed tokens, share visitors, API keys
and anonymous callers are not (FR-003, FR-011).

## R4. How every route is covered

**Fact**: about 90 routes in 20 controllers list agents or take an agent id,
as `:id`, `:agentId`, a query field or a body field. Many have no
`RolesGuard` at all. The inventory is in
[contracts/enforcement.md](./contracts/enforcement.md).

**Decision**: three mechanisms, each for one shape of route, and one test that
pins the set.

1. `@AgentScoped(source)` + `AgentAccessGuard` for routes that name the agent
   in a param, query or body. The guard resolves the caller (R3), asks
   `AgentAccessService.reaches`, and throws the same `NotFoundException` the
   route throws for an unknown agent (FR-008).
2. `AgentAccessService.reachableIds(caller)` for routes that list across
   agents; the handler filters with it.
3. `AgentAccessService.assertReaches(caller, agentId)` for routes addressed by
   a child id (a chat session, an evaluation), called after the child is
   loaded.

`agentScopedRoutes.spec.ts` walks every controller's route metadata and fails
when a route whose path contains `:agentId`, or sits under `agents/:id`, has
neither `@AgentScoped` nor an entry in an explicit exemption list with its
reason. It is the same device as `publicRoutes.spec.ts` and it is what keeps
SC-002 true after this PR.

**Rationale**: a global guard that guesses the param name would silently skip
`body.agentId`; per-handler `if` statements would be forgotten on the next
route. A declared scope plus a test that refuses an undeclared one is a rule,
not a judgment (Principle VII).

**Alternatives considered**: filtering inside `AgentGateway` (it is also used
by runtimes, the status sweep and deploy, which have no person); Prisma
middleware (hides the rule and breaks internal callers the same way).

## R5. The live channel

**Fact**: the browser hub binds a socket to one agent at handshake
(`api/src/slices/bridle/handlers/bridleClientWs.handler.ts`), verifies the
token there, and never looks at it again. Every Owner and Admin shares the
conversation `admin` of an agent (`clientIdFromJwtPayload` in
`api/src/slices/bridle/domain/chatIdentity.ts`); a User has their own. There
is no event bus in the API.

**Decision**: check at handshake, check again on each inbound `message`, and
close the sockets of an account when its access changes.
`AgentAccessService` exposes `onChanged(listener)`; the hub registers a
listener that disconnects that person's sockets for agents no longer reached.
The bridle HTTP routes (`api/agent/:agentId/*`, public by class, identity
resolved per route) get the same check inside `resolveRequester`,
`requireChannelAccess` and `BridleChatAuthGuard`, only when the requester is a
console person.

**Rationale**: FR-007 and FR-010. Without the disconnect, an Admin who lost an
agent would keep receiving the shared `admin` conversation on an open socket
until they reloaded. A plain listener is enough: the API is a single process
(CLEAN-140).

**Known and left alone**: `SSE /agents/status/stream` is `@Public()` and
streams every agent's status to anyone. It carries no identity, so it cannot
be filtered per account. The console stores ignore patches for ids they do
not hold, so nothing is rendered; the id and status of a hidden agent are
still observable on the wire. This predates the feature and belongs with
CLEAN-175 (auth by default). Listed as debt in the plan.

## R6. The Ranch assistant cannot tell who is asking

**Fact**: a tool call carries only the agent runtime's own token. For the
Ranch admin agent that is `{ sub: 'agent:<id>', roles: [Owner] }`
(`AuthService.issueAgentServiceToken`). The hub hands the person's
`{ id, email }` to the runtime with each message (CLEAN-80), and it goes no
further: nothing on the tool call names the person, and "operator" in
`docs/agent-tools.md` means "the token carries Owner". A console Admin talking
to the Ranch admin agent therefore already acts with Owner power.

**Fact, runtime** (`CleanSlice/runtime`, `origin/main` at 0.34.1): the runtime
knows who it is answering. `ToolContext` carries `from`, `user { id, email }`
and `isAdmin`; `isAdmin` is true for `from === "admin"` (the console
conversation Owners and Admins share) and for ids in
`TELEGRAM_BOT_ADMIN_IDS` (`runtime.module.ts`). It hides its *built-in*
`adminOnly` tools from everyone else (`runtime.service.ts`,
`loop.service.ts`). Tools imported from an MCP server have no such flag
(`mcp.gateway.ts`, where each MCP tool is wrapped and `client.callTool` is
called), so the Ranch tools, `delete_agent` among them, are offered to every
sender: a User, a share visitor, a messenger user. Confirmed in the user
console: as a User, the assistant offers to delete any agent.

**Decision** (clarified 2026-11-17: fix it here, runtime included; ticket
CLEAN-232, delivered first):

- A person is proven by an **acting token** the hub mints with each message
  and the runtime carries verbatim to the tool call (clarified 2026-11-17:
  the check must rest on a token that cannot be forged). It names the person,
  the one agent it is for and the session, lasts 60 minutes, carries no role.
  The API verifies it and reads role and access lists from the database.
- The catalogue is per caller: the API lists only what the effective caller
  may call, so the model is never shown a tool that would refuse it.
- A call with no actor is a guest's. Full contract:
  [contracts/acting-party.md](./contracts/acting-party.md).
- With that in place the agent-access tools, the reach filter in every
  agent-naming tool (FR-027) and a personal `pin_agent` (FR-037) are all
  deliverable, and no special rule about the Ranch admin agent is needed.

**Rationale**: with a bare user id in `_meta`, any holder of an agent token
could name the Owner. The Ranch admin agent already has Owner power, but a
plain agent does not, and `person` tools (pins, and later a User managing
their own agents) are exactly the ones a plain agent would gain by naming
someone. A token bound to person, agent and session closes that. 60 minutes
covers a long turn; a turn that outlives it loses the person's tools and the
person sends another message. Scheduled jobs carry no person and act as the
agent itself, as today.

**Alternatives considered**: a bare id (forgeable by any agent runtime);
per-person MCP clients with a header (the runtime has them for OAuth servers;
`_meta` on the call needs no second client); marking tools `adminOnly` in the
runtime (the runtime would have to know Ranch's roles, and could not tell an
Admin from the Owner or a creator from anyone else).

## R7. Personal pins

**Fact**: `Agent.pinned` is one column (migration
`20261109120000_agent_pinned`), written through `PUT /agents/:id`
(Owner, Admin). The API does not order by it; both consoles do
(`railOrder.ts` in each, `orbitLayout.ts` in app). The app hides the button
behind `canManage` / `canCreate` (`workspace/Provider.vue`), and the server
would refuse a User anyway.

**Decision**: a new sub-slice `api/src/slices/agent/pin/` with `AgentPin
(userId, agentId)`. `PUT` and `DELETE /agents/:id/pin` for any signed-in
person who reaches the agent. `AgentDto.pinned` stays in the response and is
computed for the caller, so every reader in both consoles (ordering, badges)
keeps working untouched. `pinned` leaves `UpdateAgentDto`; the column is
dropped by the migration, which discards the old marks (FR-036).

**Rationale**: keeping the field name in the DTO means the change in the
consoles is the write path and one `v-if`, not the eight readers. Dropping the
column rather than ignoring it removes the chance of a second meaning
surviving in the data.

**Alternatives considered**: pins in the browser (FR-033 wants them to follow
the account across devices); a `pins` array in user settings (no cascade when
an agent is deleted).

## R8. The ceiling, on the server

**Decision**: one write path, `AgentAccessService.replace(actor, targetId,
desired, opts)`, in a transaction that first locks the target's
`UserAgentAccess` row.

1. Who may edit whom: Owner edits Admin and User; Admin edits User; nobody
   edits the Owner or themselves (FR-012 to FR-014).
2. The actor's view is the set of agents the actor reaches. `desired` may name
   only agents inside it; one outside refuses the whole request as an unknown
   agent (FR-015, FR-019).
3. Entries about agents outside the view are carried over unchanged (FR-017).
4. Reach is computed for every agent before and after. If the actor is an
   Admin and any agent is reached after, was not before, and is not reached by
   the actor, the request is refused with `ACCESS_EXCEEDS_CEILING` (FR-016).
5. Going from limited to not limited needs `confirmOpen: true`, otherwise
   `ACCESS_OPEN_NEEDS_CONFIRM` (FR-021).
6. A `version` (the row's `updatedAt`) that no longer matches refuses with
   `ACCESS_CHANGED` (edge case: simultaneous edits).

**Rationale**: step 4 is stated over outcomes, not over operations, so it
needs no list of "dangerous" edits: emptying the allowed list, removing a
denial, anything added later, are all caught by the same comparison.

## R9. The editor

**Fact**: admin has no dual-list or multi-select. The closest piece is
`admin/slices/agent/agent/components/agent/knowledge/BindingPicker.vue`, a
searchable checkbox list. User editing is a page
(`admin/slices/user/user/components/user/edit/Provider.vue`).

**Decision**: one list of the agents the editor reaches, one row per agent,
with a three-way choice per row: no entry, allowed, denied. A sentence above
it states the outcome (FR-020). It sits on the user's detail page as its own
card and saves by itself.

**Rationale**: two lists side by side let a person drag an agent into both and
rely on code to undo it. One row with one choice cannot express a collision,
which is the property the feature description asks for. It is also the same
shape as the data (R1).

## R10. Account switch in one browser

**Fact** (app): `bridle:conversation:<agentId>`, `bridle:seq:<agentId>` and
`agent:lastOpened` are not per account and nothing removes them on sign-out.
`logout()` clears the token and the user only, and every caller navigates
client-side, so the Pinia stores (`bridle`, `agent`, `chat`) and the
`useAsyncData` payloads still hold the previous account's data when the next
one signs in. On a reload, `hydrate` puts the stored copy on screen before the
server is asked (`bridle/components/bridle/chat/Provider.vue`), and
`mergeTranscript` then keeps anything younger than ten minutes. Without a
reload, `hydrated` and `history.loaded` survive, so the previous account's
conversation would stay, not flash. Signing in as a different account from the
session-ended dialog has the same effect.

**Fact** (admin): no conversation copy, but `bridle:debug:<agentId>` and
`bridle:outbox:<agentId>:<channel>` are kept per agent, and the stores survive
a client-side sign-out the same way.

**Decision**, same in both consoles:

- A client plugin in `user/auth` watches `auth.user?.id`. When it changes to a
  different id or to null, it calls a `resetForAccount()` each data store
  exposes, clears Nuxt async data, and closes live channels. The Sentry
  plugins already watch the same value
  (`setup/sentry/plugins/sentry.client.ts`), so the pattern is in the code.
- Stored keys that hold conversation content or name an agent get the account
  id in them: `bridle:conversation:<userId>:<key>`, `bridle:seq:<userId>:<key>`,
  `agent:lastOpened:<userId>` in app; `bridle:debug:<userId>:<agentId>` and
  `bridle:outbox:<userId>:<agentId>:<channel>` in admin. Share-link
  conversations (`share:…` keys) have no account and keep their key.
- On first boot after the upgrade the old unscoped console keys are removed.
  Nothing is lost: the server transcript is the authority (`docs/state.md`).
- `hydrate` runs only once the signed-in id is known.

**Rationale**: scoping the keys fixes the reload path, the reset fixes the
no-reload path; either alone leaves one of the two observed behaviours.

**Session expiry**: the session-ended dialog (CLEAN-72) keeps the page behind
it so the same person can sign in and continue. That stays. If a different
account signs in there, the watcher fires and the page is reset before
anything is drawn for the new account. FR-029 is worded accordingly.

## R11. Stores

**Decision**: `agentAccess` store in `admin/slices/user/agentAccess/`, keyed
by user id, `upsert` and `patch` with rollback. The user store in
`admin/slices/user/user/stores/user.ts` gets `byId` and `upsert` and the three
providers that render `useAsyncData`'s `data` render by id instead, because
`UserDto` now carries the access summary and a save in the editor has to move
the badge in the list.

**Rationale**: Principle IV. The user store breaks `docs/state.md` today;
adding a second fact to it without fixing that would copy the debt.

## R12. Tests that count as done

- API: jest specs for the service (rule table, ceiling, confirm, version,
  deletion), the guard, the tools, the pin routes, and
  `agentScopedRoutes.spec.ts`. Run directly:
  `NODE_OPTIONS=--experimental-vm-modules npx jest <path>`.
- Consoles: `bun test slices` for the pure parts (outcome sentence, key
  scoping, reset), `npx nuxt typecheck`, `bun run locale:check`.
- Browser, at 390 px and 1440 px, scripts under
  `specs/032-agent-user-access/e2e/`: the account switch recorded frame by
  frame (SC-009), the editor and the ceiling as Owner and as a restricted
  Admin, a User pinning, a direct link to a hidden agent.

## R14. A role on every route

**Fact** (audit of 2026-11-17, `audit-routes` over every `*.controller.ts`):
252 routes in 46 controllers. 29 public, 15 behind machine guards, 5
Owner-only, 61 Admin and up, 5 User and up, and **137 that accept any valid
token**, because only `JwtAuthGuard` is global and `RolesGuard` lets a route
with no `@Roles` through. Among the 137: model credentials (`GET /llms`
returns `apiKey`), settings read and write, agent secrets, agent files and
imports, templates and install-from-git, skills, knowledge bases and sources,
logs, usage, paddock, integrations, browser sessions. The user console calls
only `AgentsService` and the public auth setting.

**Decision**: make `RolesGuard` global and make "no role stated" mean Admin.
State `User` on the handful of routes the user console needs and `Agent` on
the ones the runtime calls; pin both sets, as the public set already is.
Detail in [contracts/acting-party.md](./contracts/acting-party.md) section 4.

**Rationale**: adding `@Roles` to 137 handlers fixes today and leaves the
next unannotated route open again. A default that refuses, plus a test that
lists who is let in, turns the omission into a failing build (Principle VII).

**Risk**: a runtime call that relied on "any token" starts failing. Mitigated
by taking the list from the runtime's own API gateways first and by
`agentRoutes.spec.ts`.

## R15. Order of delivery

CLEAN-232 (actor, tool audiences, route roles) ships before CLEAN-231 and
does not depend on it: until the access lists exist, `AgentAccessService` is
absent and an Admin acting through the assistant reaches every agent, as in
the console. CLEAN-231 then plugs its rule into `effectiveCaller` in one
place. Runtime first, then the image bump and redeploy, then the API
(acting-party contract, section 3).

## R16. Who created an agent

**Fact**: nothing records it. `AgentDeployService.createAgent` has two
callers, `POST /agents` and the `create_agent` tool, and neither passes a
creator. Only Owner and Admin can create today.

**Decision**: `Agent.createdById`, written at creation from the console token
or the acting token; one function, `canManage`, that every management route
and `manage-agent` tool asks (contract, section 5). The creator line of that
function is inert for Users until creation is opened to them.

**Rationale**: the question raised in clarification is the right one to
answer now. If roles alone decided management, a User who is later allowed to
create an agent would be refused by the assistant when asking to delete it,
and fixing that would mean revisiting every route and tool this plan touches.
Recording the creator later would also leave every agent made in between
without one.

**Not done here**: letting Users create agents (a product decision with
quotas, templates and cost behind it). What that feature will change is
listed in the contract: the role on `POST /agents` and on the management
routes of one agent.

## R17. The assistant's connection to the API is lost on every API restart

**Fact**: `app.module.ts` runs the MCP endpoint with `statelessMode: false`,
so sessions live in the API's memory
(`mcp/transport/streamable-http.controller.factory.ts`). After a restart or a
release the runtime's session id is unknown and the API answers 404
`Session not found` (-32000). The runtime evicts and reconnects only OAuth
clients on an auth failure; a static client such as Ranch's stays dead until
the agent restarts (`mcp.gateway.ts`). This is the error in the second
screenshot, and it means every release silently disables the assistant's
tools.

**Decision**: the runtime treats 404 / `Session not found` as a lost
session: drop the client, initialise again, retry the call once.

**Alternatives considered**: stateless mode in the API (the module supports
it, and a fresh server per request has no session to lose; it is the better
long-term answer, but it changes how every MCP client of Ranch connects and
is not needed to stop the failure).

## R18. The assistant does not know its audience

**Fact**: asked by a User to delete an agent, the assistant attempted two
tools, then proposed a raw HTTP call, then described the management console.
The prompt has an admin / not-admin switch (`stripAdminBlocks`) and nothing
about role or console.

**Decision**: the hub sends `role` and `surface` beside the acting token; the
runtime adds a short audience block to the prompt of the turn; the catalogue
is already the person's own (R6). The Rancher template's guidance about the
management console moves inside its admin-only blocks.

**Rationale**: the refusal has to come from the absence of a tool plus one
instruction, not from a judgment the model makes about permissions
(Principle VII): the rule lives in the API, and the prompt only says how to
talk about it.

## R13. Translations

Two new keys in `app/slices/agent/i18n/locales/en.json`, for the empty state
of an account with no agents ([contracts/console.md](./contracts/console.md));
the pin labels already exist. `ru` comes from `bun run i18n:sync`, which needs a working
`CLAUDE_API_KEY` in `.env.project`; the key answered 401 on 2026-11-16. If it
still does at implementation time, that is a question for the owner of the
key, not a reason to hand-write `ru.json`.
