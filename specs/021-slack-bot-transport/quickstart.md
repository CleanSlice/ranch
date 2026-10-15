# Quickstart: Proving the Slack Bot Transport Works

**Feature**: [spec.md](spec.md) | **Contracts**: [slack-bot](contracts/slack-bot.md), [console-api](contracts/console-api.md), [console-ui](contracts/console-ui.md)

End-to-end run-through. No implementation here; CLEAN-139's
[quickstart](../020-agent-event-notifications/quickstart.md) covers the
local stack, seeding and the endpoint — only what is new is listed.

## Prerequisites

- Local stack as in CLEAN-139's quickstart (Postgres `postgres-local`, API on
  a side port, admin on 3001), an owner account, an `events:write` key.
- The owner's bot: `SLACK_BOT_OAUTH` (xoxb-…) and `SLACK_CHANNEL_ID` (C0…)
  in `.env.project`. The bot is invited to that channel. **Never commit or
  paste either.**
- The channel is a throwaway or the team knows a test incident is coming:
  the opening root mentions `@channel`.

## Gates before anything is switched on

1. `cd api && bun run generate && bun run build && bun run generate:swagger`,
   then `cd admin && bun run build:api` — the SDK's
   `SaveNotificationDestinationDto` has `kind`, `botToken`, `channelId`;
   `AgentIncidentDto` has `number`.
2. `cd api && npx prisma migrate deploy && npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
   — exit 0.
3. `cd api && NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/event src/slices/mcp/tool-secrets.spec.ts`
4. `cd admin && bun test slices && npx nuxt typecheck`; `bun run locale:check` at the root.
5. **Existing incidents are numbered**: `SELECT count(*) FROM "AgentIncident" WHERE number IS NULL` → 0; numbers follow `openedAt`.

## Scenario 1 — the owner switches to the bot (Story 3)

1. Settings → Notifications → choose *Slack bot* → paste token and channel
   id → Save. The page shows `kind: bot`, the token's last four characters,
   the channel id. Reload: the token is not on the page, not in the network
   response.
2. *Send test*: a plain test message from the bot appears in the channel;
   the page shows "delivered".
3. Paste a wrong channel id and test: the page says "No channel with this
   id". Remove the bot from the channel and test: "The bot is not in the
   channel — invite it".
4. Ask the Ranch agent "what is the notification destination?": kind, hint,
   channel id — no token.

## Scenario 2 — one incident, one line, the story in the thread (Stories 1, 2, 4)

With a running agent `$AGENT`:

1. Post a failure (`POST /agent-events`, `status: failed`, `reason:
   OOMKilled`). Within 5 s: one new message in the channel —
   `🔴 @channel <name> — incident #<n> · down since … · OOMKilled`, reaction
   🔴, and one thread reply "Failed" with cause, reporter, Ranch sees.
2. Post a second failure at once: the root now ends `· 2 reports`; the
   thread has "Failed again". Post five more within the same minute: the
   thread does **not** grow; after the next sweep (≤ 30 s) the root reads
   `· 7 reports`.
3. Make Ranch see the agent running (the agent is running already, so Ranch
   sees it on its next watch; or stop and start it). The root reads
   `🟢 … up, watching since …`, reaction 🟢, thread "Running again".
4. Wait 10 quiet minutes (or backdate `lastFailureAt` and `upSince` in psql,
   UTC — see the memory note on `now()`). The root reads
   `✅ … resolved … · downtime … · 7 reports`, reaction ✅, thread
   "Resolved". The channel feed gained exactly **one** message in all.
5. The Events page lists the incident as `#<n>`; the agent's Events tab too;
   `list_agent_incidents` returns `number`.

## Scenario 3 — the other endings (Story 1)

- **Unconfirmed**: post a failure for an agent Ranch holds as running and
  never touch it; after 10 min the root reads `🟢 … quiet since …,
  unconfirmed`, thread "No further reports".
- **Stopped**: open an incident, then stop the agent in the console. Root
  `⏹ … stopped by owner …`, thread "Stopped by owner — nobody was paged".
  No new channel message.

## Scenario 4 — order and retries (Story 2, edge cases)

1. Block `slack.com` (hosts file or a firewall rule) and open an incident,
   join it twice, let it close. Unblock. The outbox drains in `seq` order:
   the thread shows Failed, Failed again, Resolved, in that order, and the
   root was posted **once**, already in its final state.
2. Delete the root message in Slack by hand, then join the incident: the
   thread reply still lands (as a reply to the deleted root, Slack keeps the
   thread), the destination's last delivery says "Could not update the
   incident message: message_not_found", the delivery row is `sent`.
3. Two API processes on the same database (CLEAN-139 quickstart): post two
   failures for one agent to both at once — one root, one `#number`.

## Scenario 5 — the webhook did not change (Story 5)

Switch back to *Incoming webhook* with the CLEAN-139 address, run Scenario
2 steps 1–4: exactly two messages, the texts of CLEAN-139, no thread, no
reaction. `notificationText.spec.ts` snapshots unchanged.

## Done when

- Scenarios 1–5 pass against the owner's bot and the PR lists which were
  run live and which in specs.
- No secret in: any API answer, the admin page source, any tool result, any
  `lastDeliveryError`, the API log.
- Twin-console statement in the PR: `admin` changed; `app` has no
  `agent/event` sub-slice (0 matches).
