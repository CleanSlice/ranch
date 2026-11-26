# Quickstart: proving it works

Contracts: [api](./contracts/api.md) · [ui](./contracts/ui.md). Shapes: [data-model](./data-model.md).

## Prerequisites

- Local stack as in the worktree setup notes: `bun install`, `cd api && bun run generate && bun run build`, Postgres up (`postgres-local`), seed, API on its port, `cd app && npx nuxt prepare`.
- Three accounts: an Owner, an Admin and a User who reaches at least two agents.
- For the User, with agent A: one running conversation with messages and at least three closed ones made through New chat (they have real transcripts). With agent B: at least one conversation.
- For the volume checks: `node specs/036-agent-history-switch/e2e/seed.mjs --user <id> --agent <A> --count 200` adds closed index rows dated across the last 60 days. Seeded rows have no transcript; use them for the list, never for reading.

## Automated

```bash
# api: jest directly, not `bun run test` (that regenerates Prisma under a running API)
cd api && npx jest myChat chat.gateway agentScopedRoutes && bun run build

# app
cd ../app && bun test slices/chat slices/agent slices/bridle && npx nuxt typecheck

# repo
cd .. && bun run locale:check && bun run i18n:check && bun run test:scripts
```

Expected: all green. Restore any generated SDK file that typecheck rewrote beyond the `getMyChats` hunks.

## Scenario 1: the list belongs to the agent (Story 1, SC-004)

1. As the User, open agent A. The header shows Chat | History with the number of closed conversations with A.
2. Choose History. The running conversation is first; closed ones follow under Today, This week, Earlier. No row of agent B.
3. Open agent B from the rail. The panel is in Chat; its counter is B's.
4. Type half a message in A's chat, switch to History and back: the text is still there.
5. Ask A something long, switch to History while it answers, come back: the full answer is in the feed (SC-008).

## Scenario 2: reading in place (Story 2, SC-001, SC-002)

1. From A's list open a closed conversation: two clicks from the chat. No composer; the line says it is closed.
2. Load older messages to the top. Open a cited source and rate a reply, as on the old page.
3. Escape → the list, at the same scroll position. Escape → the chat. Escape again → nothing.
4. Open a closed conversation, reload the page: same agent, same conversation. Browser Back → the list.
5. Put a made-up id in `chat=`: "not found" with the way back.

## Scenario 3: search (Story 3, SC-003)

1. With the 200 seeded rows, choose History: the list is there within a second; the counter reads 99+.
2. Type a word that is in one old row's title: only that row within a second of the last key, though it was far down the list.
3. Type nonsense: "nothing found", with what search covers.
4. Open a result, go back: the same search and results. Go to Chat and back to History: the field is empty.
5. Type a fragment of the User's own id: no rows on that ground.

## Scenario 4: Overview (Story 4, SC-005, SC-009)

1. List view at 1440 px, a closed conversation of 30+ messages with a summary: the Overview stands to the right with counts, Summary & insights, Navigation, Export.
2. Pick an entry in Navigation: the messages scroll to it.
3. Orbit view: the Overview is closed; the bar has its control. Open it, pick a Navigation entry: it closes and the message is on screen. Open it, press Escape: it closes and the conversation stays.
4. Export JSON, MD and CSV. Compare each with a file exported from the same conversation on `main` before this change: identical.

## Scenario 5: the old way is gone (Story 5, SC-007)

1. No Agents / History tabs in the top bar; the logo leads to the agents. No History link on the landing page when signed in.
2. Open `/chats`: lands on the agents.
3. Open `/chats/<id of a closed conversation>`: lands in its agent with that conversation open. With the id of the running one: lands in the chat.
4. As a User who lost access to the agent, open the same link: "not found".
5. `grep -rn '"/chats' app/slices` shows only the two redirect pages and the auth prefixes.

## Scenario 6: narrow (Story 6, SC-006)

Repeat Scenarios 1 and 2 in the Orbit view and at 390 px: icons instead of labels with the counter visible, no sideways scroll, nothing clipped, the New chat confirmation inside the screen.

## Scenario 7: New chat (Story 7)

1. In A's chat with messages, New chat → confirm: empty chat, counter one higher, the closed conversation first under Today, without Sync.
2. From the list, and from an open closed conversation, New chat → confirm: the panel goes to the chat.
3. With an empty conversation: New chat is unavailable and says why.

## Scenario 8: who sees what (FR-028)

1. As the Admin and as the User, both with conversations with agent A, each sees only their own rows and their own counter.
2. `GET /me/chats?agentId=<an agent the User does not reach>` with the User's token: 404.
3. `GET /me/chats` with no new parameters answers as it did before.

## Evidence

The scenarios are driven through Playwright at 1440 px (list view), in the Orbit column and at 390 px, with console errors and failed requests read. There is no committed script for it yet: the run of 2026-11-26 is written up at the end of [tasks.md](./tasks.md). Screenshots stay out of the repo; the result goes on the ticket in one line.

The stack for it: the API of this branch on a database whose name contains "e2e", MinIO for the transcripts, `node specs/035-tool-reconnect-chat-queue/evidence/runtime.mjs` for the agents, and the app with `API_URL` pointing at that API. `e2e/seed.mjs` and the runtime take the API's environment plus `E2E_API`, `E2E_APP` and `E2E_CONTROL`.
