# Research: Chat History Inside the Agent

Every unknown from the Technical Context, settled against the code in `main` at `c1cfe603`.

## R1. Filtering a person's own conversations by agent and text

**Decision**: `GET /me/chats` takes two more optional query parameters, `agentId` and `search`, and hands them to the same `IChatGateway.list` it calls now.

**Rationale**: `ChatGateway.buildWhere` already narrows by `agentId` and by `search` (title or preview, case-insensitive); the admin route `GET /chats` and the `list_chats` tool use it. `MyChatsQueryDto` leaves the two out on purpose ("those admin filters must not be exposed"), which was right while the only reader was a page across all agents. The own-list rule stays untouched: `channel = bridle`, `externalUserId` from the token, agents the caller reaches.

**Alternatives considered**:
- Call `GET /chats?agentId=` from the app. It is `Owner`/`Admin` only and returns everyone's conversations; a User would get 403 and an Admin would see other people's rows.
- Filter in the browser over the unfiltered own list. Works for a handful of rows; the counter and search would be wrong as soon as there are more conversations than one page (max 100).

## R2. Guarding the agent named in the query

**Decision**: mark the route `@AgentScoped('query.agentId')`, the decorator `syncMyChats` already carries for `body.agentId`. An agent the caller does not reach answers 404, as on every other route.

**Rationale**: `agentScopedRoutes.spec.ts` pins that every route naming an agent goes through this guard; a hand-written check would be the exception the spec exists to prevent. Inside the handler `agentId` wins over `agentScope` in `buildWhere`, which is safe only because the guard has already proved reach.

`AgentScopeSources` already has the `query.agentId` form, so nothing in the guard changes.

**Alternatives considered**: answer an empty list for an unreachable agent. Leaks nothing either, but gives this one route its own rule.

## R3. Search must not match the person's own id

**Decision**: in `buildWhere`, the `externalUserId contains search` branch is left out when the filter is already pinned to one `externalUserId`.

**Rationale**: the branch exists so an Admin can find a visitor by id. In a list that holds one person's rows it matches every row or none, so a search that happens to be a fragment of the caller's id would return the whole list. The spec promises title and last message only (FR-014). A rule, not a flag: the caller cannot switch it.

**Alternatives considered**: a separate `searchFields` option on the filter. More surface for the same effect.

## R4. Running and closed conversations are two lists on the server

**Decision**: the app asks twice per agent: `archived=false&agentId=X` for the running conversation (normally zero or one row) and `archived=true&agentId=X&search=…&page=n` for the closed ones. The History counter is the `total` of the closed list asked **without** a search.

**Rationale**: the route defaults `archived` to false and the store comment says the two are separate lists (CLEAN-136). Keeping that contract means no behaviour change for anyone else. Two small requests in parallel are well inside SC-003. The counter cannot come from a searched response, so the store writes `closedTotal` only from unsearched ones.

**Alternatives considered**: a third `archived` value meaning "both". One request instead of two, but the running row would have to be fished out of a page sorted by time, and the total would mix the two.

## R5. When the first page is loaded

**Decision**: the first unsearched page of an agent's history is loaded when the agent opens, not when History is chosen. Page size 30.

**Rationale**: the counter needs a total anyway, so the request is made regardless; taking 30 rows with it makes the list appear with no wait (SC-003) and costs one request per opened agent. 30 rows is about three screens of the panel; the API allows up to 100. A failure of this background load shows nothing in the header and is retried when History is chosen.

**Alternatives considered**: `perPage=1` just for the count, then the list on demand: two requests where one will do, and the pattern CLEAN-238 is removing from admin.

## R6. Where the panel view lives

**Decision**: in the address of the agent page: `/agents/:id` is the chat, `?view=history` the list, `?view=history&chat=<conversationId>` one conversation. Changes are `router.push`, so the browser's Back steps the same way Escape does. A pure module `agent/utils/panelView.ts` parses the query, builds addresses and answers "one step back from here".

**Rationale**: FR-023 asks for reload and Back to work, which is what an address is. The agent page already has one key for every `/agents/:id`, so a query change re-renders nothing above the panel. Selecting another agent navigates to `/agents/:other` with no query, which is FR-004 for free. Nothing is stored in the browser, matching "the view is not remembered between visits".

**Alternatives considered**:
- Component state. Loses reload and Back.
- Nested routes `/agents/:id/history/:chat`. Would need the workspace to become a parent route and the page key to be re-thought (CLEAN-229 fixed exactly that); the query gives the same result with no route changes.

## R7. Keeping the chat alive under History

**Decision**: `AgentChatProvider` stays mounted and is hidden with `v-show` while History is shown; the history component is rendered beside it with `v-if`.

**Rationale**: the live chat holds a socket subscription, the composer's unsent text, the queue and the scroll position. Unmounting it would drop all four and fail FR-005 and SC-008. Hidden, it keeps receiving, so an answer finishes while the person is elsewhere.

**Alternatives considered**: `<KeepAlive>`. The provider is keyed by agent and wraps async setup; `v-show` is the smaller, more predictable tool for "two things, one visible".

## R8. Escape

**Decision**: one `keydown` listener in `useAgentPanelView`, active only while the view is not the chat. It does nothing when an element with `role="dialog"` is open (New chat confirmation, share panel), when the Overview is open over the messages (it closes that first), or when the event comes from the agents search field, which uses Escape to clear itself.

**Rationale**: FR-022. New chat and the share panel listen on `document` and do not stop the event, so the order has to be decided by a rule here rather than by who registered first.

## R9. The Overview's two layouts

**Decision**: one `Overview.vue` with the four parts of the old right rail. The reading view is a container; at 880 px of panel width and above the Overview is a 300 px column beside the messages, below that it is closed by default and opened over the messages by a control in the bar.

**Rationale**: 880 = 300 for the Overview, 24 for the gap and about 556 left for the messages, the narrowest the bubbles stay readable at their current 85 % maximum width. In practice: the list view at 1440 px gives the panel about 1168 px (column), the Orbit view gives 500 to 720 px (overlay), a phone 390 px (overlay). A container query, not a viewport one, because the same viewport holds both a wide and a narrow panel depending on the workspace view.

**Alternatives considered**: Overview under the messages on narrow panels. Navigation at the bottom of a 200-message conversation is unreachable, which defeats its purpose.

## R10. The switch in the sheet

**Decision**: the sheet's fold line becomes three groups: identity (grows), conversation (switch and New chat, centred), agent actions and the fold toggle (grows, right-aligned). Labels of the switch and New chat are hidden below 700 px of sheet width, the prototype's value; the counter stays. Below 520 px the agent actions already drop to a second row; the conversation group stays in the first.

**Rationale**: equal growth on both sides is what keeps the middle group on the axis of the feed, which is the point of variant A. `NewChat.vue` is drawn icon-only by the sheet today through a scoped rule; that rule moves under the 700 px condition.

**Check at implementation**: the New chat confirmation is positioned `absolute right-4 top-full` against the nearest positioned ancestor. In the middle group that ancestor changes; verify at 390 px that the card stays inside the screen.

## R11. Telling the panel that a new chat started

**Decision**: `NewChat.vue` emits `confirmed` when the person confirms. The sheet turns it into "go to the chat". The chat store refreshes the agent's history when `bridleStore.newChatBlock(key)` leaves `busy`.

**Rationale**: FR-027. Going to the chat on confirmation, not on success, also puts the person in front of the failure notice, which is written into the chat's own strip. Refreshing on leaving `busy` covers success and failure with one rule; a refresh after a failure is a harmless reload.

**Check at implementation**: confirm that the archive call marks the index row archived before it answers (`archiveSession`). If the row can lag, the refresh is preceded by `syncMine(agentId)`.

## R12. Old addresses

**Decision**: `/chats` becomes a page that redirects to `/agents`. `/chats/:id` asks for the conversation, then redirects to `/agents/<its agent>?view=history&chat=<id>`, or to the plain agent address when the conversation is the running one; a 404 shows the existing "conversation not found" text with a link to the agents. Both stay under the auth middleware's protected prefixes.

**Rationale**: FR-025, SC-007. The agent of a conversation is only known after the fetch, so the second redirect cannot be a static rule.

## R13. Store shape

**Decision**: see [data-model.md](./data-model.md). `byId` for records, one history index per agent holding ids, totals and load state; a request generation per agent so a slow answer for an old search cannot land under a new one; `resetForAccount` empties all of it.

**Rationale**: `docs/state.md` rules 1 to 4. The existing guard against a late answer (`showArchived` pinned before the await) is the same idea, generalised.

## R14. Generated SDK

**Decision**: `cd api && bun run generate:swagger`, then `bun run build:api` in `app` and in `admin`. Commit only the hunks that belong to `getMyChats`; other drift in the generated files is restored.

**Rationale**: generated code is generated. The admin SDK is built from the same spec, so it is regenerated to stay in step even though admin never calls this route.

## R15. Dates and words

**Decision**: day groups are computed by `historyGroups.ts` from `lastMessageAt` and "now" in the browser's time zone; times in rows go through `useFormat()`. Titles, previews and summaries are printed as received.

**Rationale**: `docs/i18n.md` and `bun run locale:check`. The private relative-time function in the old card is not carried over.

## Values a reviewer would otherwise take on trust

| Value | Where | Reason |
|-------|-------|--------|
| 30 | history page size | about three screens of rows; one request also serves the counter |
| 250 ms | search debounce | a pause in typing, well inside the 1 s of SC-003 |
| 100 | max length of `search` | longer than any title or preview fragment worth typing; bounds the query |
| 99+ | counter cap | two digits fit the switch at icon size |
| 880 px | Overview beside or over | 300 + 24 + the narrowest readable feed |
| 700 px | switch labels | prototype value, checked against the Orbit column (500 to 720 px) |
| 6 days | "This week" | the spec's definition: the six days before today |
