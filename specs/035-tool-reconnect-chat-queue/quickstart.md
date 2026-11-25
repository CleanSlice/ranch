# Quickstart: proving it works

Contracts: [runtime](./contracts/runtime.md) · [api](./contracts/api.md) · [ui](./contracts/ui.md). Shapes: [data-model](./data-model.md).

## Prerequisites

- Local stack as in `ranch-worktree-setup`: `bun install`, `cd api && npx prisma generate && bun run build`, Postgres up, `make k3d`.
- A runtime image built from the `feat/CLEAN-245-tool-reconnect` branch, loaded into k3d and set as the template's image.
- One agent with a knowledge base (so it has the `Documents` server) and one Owner, one Admin, one User account.
- For short runs: `MCP_START_GRACE_MS=20000` on the agent, `TOOLS_LIMITED_ALERT_MS=60000` on the API.

## Automated

```bash
# runtime repo
bun test src/slices/setup/mcp src/slices/agent/agent

# ranch
cd api && bun run test -- toolState agentToolState agentEvent bridle agentAdmin userRoutes routeRoles
cd ../admin && bun test slices/bridle slices/agent
cd ../app && bun test slices/bridle slices/agent slices/share
cd .. && bun run typecheck && bun run locale:check && bun run i18n:check && bun run test:scripts
```

## Scenario 1 — the 20 November replay (SC-001, SC-003)

1. Stop the API. Delete the agent's pod so it restarts against a dead API.
2. After 90 s start the API.
3. Without touching the agent, ask it "how many model years do you cover?".

Expected: the runtime log shows `Documents: connect failed`, then attempts, then `Documents: registered N tools`; the answer comes from the documents; the agent was never restarted. From API up to a correct answer: under three minutes.

## Scenario 2 — a start that explains itself (SC-004)

1. Break only the tool server: keep the API up but point the `Documents` server at a closed port. Restart the agent.
2. Watch the admin chat and the agents list as Owner; watch the app chat as User.

Expected, in order: "Starting agent…" → "Connecting tools…" with "Documents is not answering yet — trying again (attempt N, …)" for the Owner and "Starting — almost ready…" for the User → after the waiting limit, **Limited tools** for the Owner and "Part of this assistant's knowledge is temporarily unavailable." for the User. No server name anywhere in the User's page or its network traffic.

3. Ask the agent a document question. Expected: it says that part is unavailable and that it is still reconnecting.
4. Ask the Ranch agent as Admin "what is wrong with «agent»?". Expected: it names Documents and `retrying`.
5. Wait past the alert threshold. Expected: one incident `limited`, one notification.
6. Restore the port. Expected: within a minute the mark disappears in both consoles without a reload; the incident closes after the quiet period.

## Scenario 3 — refused is not an outage

Give the `Documents` server a wrong token and restart. Expected: state `refused`, one attempt only, the Owner's line says to check its credentials, the agent does not tell anyone to try again later.

## Scenario 4 — a call across a dropped connection

With the agent ready, restart the API and, as it comes back, ask for a document lookup; then ask the Ranch agent to change something. Expected: the lookup succeeds (one reconnect in the log); a write that hit the gap returns "outcome unknown" and is not sent twice (check the API log for a single request).

## Scenario 5 — the queue (SC-005, SC-006, SC-007)

In `admin`, in `app`, and on a share link:

1. Restart the agent. While it starts, type three messages. Expected: "Queued · 3", the input is free each time.
2. Type a fourth. Expected: not queued, text kept, the "three are waiting" line.
3. Move the third to the top with the handle, then back down with `Alt+↓`. Remove the second. Reload the page. Expected: two rows, in the order left.
4. Let the agent become ready. Expected: the first row is sent and answered, then the second; each exactly once.
5. While the agent is answering a long question, send another. Expected: it queues and goes out when the answer ends.
6. Open the same chat in a second tab during step 4. Expected: no message is sent twice.
7. Stop the agent with two messages queued. Expected: "The agent did not start. Your messages are kept." and nothing sent.

## Scenario 6 — old runtime

Set the template image to 0.39.0 and restart. Expected: no tool state anywhere, today's status line, the queue still works.

## After release

- Production: restart the assistant; `GET /agents/:id/tool-state` as Owner returns `ready`-equivalent (`null` summary); queue three messages in the Owner chat during the restart and see them answered in order.
- The Mazda fork gets the status and the queue on its next catch-up; the reconnect waits for its template image to move.
