# Quickstart: seeing "New chat" work

**Feature**: [spec.md](spec.md) | **Contracts**: [archive-transcript](contracts/archive-transcript.md) · [conversation-reset](contracts/conversation-reset.md) · [new-chat-ui](contracts/new-chat-ui.md) · [chat-history](contracts/chat-history.md) · [agent-rail](contracts/agent-rail.md)

A validation guide, not an implementation guide. Each step names the
requirement it proves.

## Prerequisites

- The stack running locally: `bun run dev` from the repo root (api on 3333,
  app on 3000, admin on 3001), with one agent in `running` state.
- An Owner login, and a second login without the Owner/Admin role.
- A share link for the agent: open the agent in the customer console → Share.
- Two browsers (or one plus a private window) for the visitor steps.

## Gates

Run before any manual step; all must pass.

```bash
# api — run jest directly; `bun run test` regenerates Prisma and takes a running dev API down with it
cd api && npx jest src/slices/bridle src/slices/chat
cd api && bun run build            # this is the api typecheck

# regenerate the spec and both SDKs — the route's answer and refusals changed
cd api && bun run generate:swagger
cd app && bun run build:api
cd admin && bun run build:api

# consoles
cd app && bun test slices && npx nuxt typecheck
cd admin && bun test slices && npx nuxt typecheck

# copy and locale rules
bun run i18n:sync                  # generates ru for the new keys
bun run i18n:check
bun run locale:check
```

Expected: every command exits 0. `admin` typecheck has eight known
`monaco-editor` errors on `main`; anything beyond those is this change's.

## Scenarios

### 1. Visitor starts over (US1 · FR-001–005)

1. Open the share link in a private window. Say: `Remember the code word: plover.`
2. Wait for the answer. Press **New chat**, read the confirmation, press
   **Start new chat**.
3. **Expect**: the starting state within 2 s (SC-001), an empty composer.
4. Ask: `What is the code word?` **Expect**: the agent does not know (SC-002).
5. Reload. **Expect**: only the new exchange (SC-003).

### 2. Cancel changes nothing (US1 scenario 4)

Press **New chat**, then Cancel; then again and press Escape; then again and
click outside. **Expect**: the conversation is intact each time.

### 3. Console user starts over and keeps the old one (US2 · FR-018)

1. Sign in to the customer console, open the agent, repeat scenario 1's code
   word test with the header's **New chat**. Run it once as the Owner (the
   shared conversation) and once as a user without the Owner/Admin role (their
   own), if such a user can open the agent.
2. Open **Chats** → **Earlier**. **Expect**: one closed conversation, marked
   Closed, containing the code word exchange.
3. Start a second new chat after another exchange. **Expect**: two entries
   under Earlier (SC-004).

### 4. Everyone on the conversation sees it (US2 scenario 4 · FR-019 · SC-008)

1. Sign in as the Owner in the customer console **and** open the same agent's
   chat in the admin console.
2. Send a message from either. Press **New chat** in the customer console.
   **Expect**: the admin console's chat empties within 2 s, no reload.
3. Send a message, then use the admin console's own **New chat**.
   **Expect**: the customer console's chat empties within 2 s.
4. Second tab of the share page, same browser: reset in one tab.
   **Expect**: the other empties.

### 5. Unavailable, and says why (US3 scenario 1 · FR-008, FR-009)

| Set-up | Expect |
|--------|--------|
| Fresh conversation, no messages | button disabled, hint "already empty" |
| Stop the agent (admin console) | button disabled, hint "agent is unavailable"; comes back without a reload when the agent returns |
| Send a long question and look while the agent is thinking | button disabled, hint "wait for the agent" |

### 6. The server refuses on its own (US3 · FR-010, FR-011)

The browser's disabled button is a convenience; the route must hold alone.
With a share visitor's headers:

```bash
# while the agent is answering a long question
curl -s -X POST "http://localhost:3333/api/agent/$AGENT/transcript/archive?channel=share-$VISITOR" \
  -H "X-Share-Token: $TOKEN" -H "X-Share-Visitor: $VISITOR"
```

**Expect**: `409` with `TURN_IN_PROGRESS`; the conversation and storage
untouched. Repeat with the agent stopped: `409` with `AGENT_OFFLINE`.

### 7. A failure is shown as a failure (US3 scenario 2 · SC-006)

In the browser's dev tools, block `*/transcript/archive`. Press **New chat**
and confirm. **Expect**: the conversation unchanged and the notice "Could not
start a new chat. Your conversation is unchanged."

### 8. Isolation (FR-006 · SC-005)

1. Two visitors (two browsers) on the same link, each with a conversation.
   Visitor A resets. **Expect**: B's conversation untouched; the Owner's
   console conversation untouched.
2. With A's headers, name B's channel:
   `…/transcript/archive?channel=share-$VISITOR_B`. **Expect**: `403`.

### 9. The closed conversation is complete, once (US4 · FR-007 · SC-004)

1. As a visitor: three exchanges, then **New chat** within a second of the
   last answer finishing, then one more message.
2. Admin console → Chats, tick **Archived**. **Expect**: one closed
   conversation for that visitor containing all three exchanges, the last
   answer included.
3. Untick **Archived**. **Expect**: one live conversation for that visitor
   with the single new message — and no second, hollow entry for the old one.
4. Rate a message in a console conversation, start a new chat, open the closed
   conversation. **Expect**: the rating is still there.

**Measure here**: how long the route waited for the agent's push on this reset
(the route logs it). Record it in the PR. SC-001 assumes it is well under two
seconds; research D5's 5 s timeout is revisited if it is not.

### 10. Revoked link (US3 scenario 4 · FR-014)

Open the share page, revoke the link from the console, press **New chat** and
confirm. **Expect**: the "link is no longer active" state; nothing closed.

### 11. Double press (FR-013)

Confirm and immediately press the button again (or call the route twice in a
row). **Expect**: one closed conversation in history.

### 12. Russian (US1 scenario 6 · FR-015)

Switch the console to Russian and walk scenarios 1, 3 and 5.
**Expect**: no English in the button, the confirmation, the hints, the notice,
the history filter or the Closed marker.

### 13. Memory is not promised and not touched (FR-016)

Read both confirmations: neither says "forget everything", "erase" or
"delete". In the admin console's Files tab, `MEMORY.md` is unchanged by a
reset.

### 14. The same conversation everywhere (US5 · FR-020 · SC-009)

1. As the Owner, hold a three-exchange conversation with an agent in the
   **admin** console.
2. Open the same agent in the customer console in a private window that has
   never opened it. **Expect**: the same six messages, the person's included,
   in order, within 2 s of the chat opening.
3. Send a message with a file from the admin console; reload the customer
   console. **Expect**: the message with its attachment chip (FR-023).
4. Share page: hold a conversation, clear the conversation's entry in
   `localStorage` (keep the visitor id), reload. **Expect**: the conversation
   is back, from the server.

### 15. Reloads neither duplicate nor lose (US5 scenario 3 · FR-022 · SC-010)

Reload the customer console chat at each of these moments, twenty reloads in
all, and compare with the admin console's view of the same conversation:

| Moment | Expect |
|--------|--------|
| Idle | identical lists |
| While the agent is answering | the question once; the answer arrives once |
| Within two seconds of an answer finishing | the answer once — not missing, not doubled |
| With an undelivered message (block the socket in dev tools, send, unblock, reload) | the message once, marked not delivered |
| After sending "ok" twice, a few minutes apart | two "ok" messages |

**Measure here**: after an answer finishes, how long until
`GET …/transcript` returns it. Record it in the PR next to the ten-minute
bound of research D14 — the bound assumes this is seconds.

### 16. Earlier messages (US5 scenario 2 · FR-021)

In a conversation of more than fifty messages, scroll to the top.
**Expect**: "Loading earlier messages…", then older messages above, and the
message that was at the top of the screen still where it was.

### 17. A device that was away (US5 scenario 6 · FR-025)

1. Open a console conversation in browser A; close the browser.
2. In browser B, start a new chat and send one message. Wait eleven minutes.
3. Reopen browser A. **Expect**: the new conversation only.

Also with the network blocked for `*/transcript*`: **expect** the chat to show
what the browser had and to stay usable (FR-024); unblock and reload:
**expect** it to catch up.

### 18. The Ranch admin agent is first (US6 · FR-026 · SC-011)

1. With at least three agents and the admin agent not the newest, open
   `/agents`. **Expect**: it is the first entry, with the shield; the others
   newest first.
2. Search for another agent's name. **Expect**: the admin agent is filtered
   out like the rest.
3. Clear the "last opened" memory and reload `/agents`. **Expect**: the
   landing rule is unchanged — the first running agent in the API's order, not
   necessarily the admin agent.
4. In Russian: **expect** the shield's label in Russian (FR-027).

## Not verified here

- A reset reaching a device within the hub's replay window after an API
  restart: the frame is lost with the hub's memory, and the stored copy is
  shown until it is ten minutes old (research D14).
- A turn silent for more than 75 s that then speaks — closed only by the
  runtime companion change (research D13). With that change deployed: start a
  long tool call, reset from a second tab's dev console once the 75 s have
  passed, and **expect** no late answer in the new conversation.
