# Research: Slack Bot Transport

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

What had to be decided before the design, and why each way. Numbered so the
plan and the tasks can point at them. Facts marked *(verified)* were checked
against the live "Ranch Alerts" bot on 2026-10-14; the rest is Slack's
documented behaviour.

## F1. What a bot can do that a webhook cannot *(verified)*

| Need | Incoming webhook | Bot token (Web API) |
|------|------------------|---------------------|
| post to the channel | yes, one fixed channel | `chat.postMessage` — any channel the bot is in |
| know which message was posted | no | `ts` in the answer |
| reply in a thread | no | `chat.postMessage` with `thread_ts` |
| edit a message | no | `chat.update` |
| put / remove a reaction | no | `reactions.add` / `reactions.remove` |

All four calls were made with the owner's bot and the two permissions
`chat:write`, `reactions:write`. Nothing else is needed: the channel id is
typed in by the owner, so `channels:read` is not required, and the bot edits
only its own messages, so `chat:write.customize` is not either.

## F2. Two Slack facts that shape the design

1. **`chat.update` notifies nobody.** Rewriting the root is silent, which is
   exactly right for the count and the state — and exactly wrong for "the
   agent is back", which people may want to hear. The thread reply is what
   can notify (people who follow the thread, or the channel if they chose
   to). So every change is both: a reply (the news) and a rewrite (the
   state). FR-014, FR-010.
2. **`<!channel>` inside a thread reply reaches only the thread's
   followers**, not the channel, unless the reply is also broadcast to the
   channel. This feature never pings from a thread; the one mention is in the
   first version of the root (FR-011, FR-016). CLEAN-166 will need
   `reply_broadcast` or a channel-level post for its urgent pings — noted
   there.

## D1. The Web API is called with `fetch`, no Slack SDK

**Decision**: `SlackBotNotifier` in `data/` calls the four methods over
`fetch` with `Authorization: Bearer <token>` and a JSON body, the way
`SlackWebhookNotifier` already calls the webhook. No dependency added.

**Rationale**: four endpoints, one shape of answer (`{ ok, error?, ts? }`),
`Retry-After` on 429. The SDK would add a dependency for a `fetch` wrapper
and would not change any decision below. The existing notifier's timeout,
address-scrubbing and 429 handling are reused.

**Alternatives**: `@slack/web-api` — rejected for the reason above.

## D2. One destination row, a `kind`, nullable secrets

**Decision**: `AgentEventDestination` keeps its single row (`id = 'slack'`).
`kind` becomes `'webhook' | 'bot'` (today's value `'slack'` is migrated to
`'webhook'`). `webhookUrl` becomes nullable; `botToken` and `channelId` are
added, nullable. Exactly one of (`webhookUrl`) / (`botToken` + `channelId`)
is set, by `kind`. `hint` is the last four characters of whichever secret is
set. Saving one kind nulls the other's secret (FR-006).

**Rationale**: the destination is "where the team is told", one per install
(spec assumption). Two rows would invite two active transports and a choice
nobody asked for. The secret rule of CLEAN-139 D10 — this table, never
`Setting`, never returned — carries over unchanged; `getDestination()` stays
the only read that returns a secret.

**Alternatives**: a generic `secret` column — rejected: a reviewer cannot
tell what is in it, and validation differs per kind. A second table for the
bot — rejected: two "current destination" rows.

## D3. A second port for the bot, the webhook port untouched

**Decision**: `INotifier` (webhook: `send(address, message)`) stays as it
is. A new abstract `ISlackBotNotifier` in `domain/notifier.ts` has:

```ts
post(cred, message, threadTs?)      → { ok: true, ts } | failure
update(cred, ts, message)           → { ok: true } | failure
setReaction(cred, ts, name, previous) → { ok: true } | failure   // remove previous, add name
```

`cred = { token, channelId }`. The failure shape is today's
`NotifyResultTypes` (`retryable`, `retryAfterMs`, `error` — never the token).

**Rationale**: the webhook's contract is one call with one answer; the bot's
is three calls with a message identity between them. Forcing them into one
interface would give the webhook three methods it cannot implement. The
worker picks by `destination.kind`, which is the one place that knows both.

## D4. The outbox grows two kinds and an order

**Decision**: `AgentNotification.kind` becomes
`'opened' | 'joined' | 'running' | 'closed'`. The unique `(incidentId, kind)`
is replaced by `(incidentId, seq)` where `seq` is a per-incident counter kept
on the incident (`notificationSeq`) and copied into the row at queue time.
`claimDueNotification` claims a row only when no earlier `seq` of the same
incident is still `pending` (FR-019): one `NOT EXISTS` in the claim query.

**Rationale**: "one opening and one closing per incident" is still true and
still enforced — `opened` and `closed` are queued only by the two writes
that can happen once (`openIncident`, `closeIncident`), as today. `joined`
can repeat, so the old unique has to go. The order matters only inside one
incident; across incidents the outbox stays free-running. The `NOT EXISTS`
costs an index probe per claim on a table of tens of rows.

**Alternatives**: deliver each incident's rows in one go — rejected, a slow
Slack would then hold one replica for a whole incident. Order by `createdAt`
— rejected, two replicas' clocks are not an order.

## D5. The incident records its transport, its root and its reaction

**Decision**: when an incident opens, it copies the destination's `kind` into
`transport` (`'webhook' | 'bot' | null` when there is no destination). The
first delivery of a bot incident stores `slackChannel` and `slackTs` of the
root on the incident; `slackReaction` holds the name of the one reaction the
bot currently has on it. `joined` and `running` rows are queued only when
`transport = 'bot'` — the webhook never had anything to say at those moments
(FR-021), and an incident finishes on the transport it started on (FR-022).

**Rationale**: a retry of the `opened` delivery must not post a second root:
the root's `ts` is written to the incident the moment Slack answers, before
the thread reply is attempted, and a retry that finds `slackTs` set skips the
post. Switching the destination mid-incident is then harmless by
construction.

## D6. The root is rendered from the incident, never from the last text

**Decision**: every rewrite calls `renderRoot(incident, consoleUrl,
{ mention })` on the incident row as it is at delivery time (state, counts,
times, resolution). `mention` is true only for the very first post. The
rewrite and the reaction swap ride on whichever delivery caused the change
(FR-018) and their failures are recorded on the destination, not on the
delivery (FR-020).

**Rationale**: two replicas may deliver two rows of one incident close
together; whichever `chat.update` lands last carries the current state,
because both rendered from the row and the row only moves forward (FR-013,
SC-002).

## D7. "Failed again" at most once a minute; the count catches up on the sweep

**Decision**: `touchIncidentFailure` queues a `joined` row only when the
incident's `lastJoinedNotifiedAt` is null or older than 60 s, and sets it in
the same conditional `updateMany` — so two reports arriving together on two
replicas queue one reply. A report that is swallowed marks the incident
`rootStale = true`. The existing 30-second incident sweep rewrites every open
bot incident with `rootStale` and clears the flag.

**Rationale**: FR-015 wants the thread calm and the root current. Queueing a
delivery for every report would make the throttle pointless; rewriting the
root from the ingest path would put Slack on the sender's request. The sweep
already runs, already reads every open incident, and bounds the rewrites to
one per incident per 30 s whatever the flood.

**The number 60 s**: Slack posts about one message per second per channel;
a minute keeps a crash loop (a report every 10–20 s) to a handful of
replies per incident and still shows a human the loop is going on.

## D8. The incident number is a database sequence

**Decision**: `AgentIncident.number Int @unique @default(autoincrement())`.
The migration adds the column, numbers existing rows in `openedAt` order
with `row_number()`, and sets the sequence past the maximum.

**Rationale**: FR-023 needs "unique, increasing, never reused, safe under
concurrent opens on two replicas" — that is a Postgres sequence and nothing
built by hand. Gaps (an open that lost the `openKey` race after taking a
number) are acceptable and expected; the spec asks for order, not density.

**Alternatives**: per-agent numbering ("Test Chatbot #3") — rejected, the
root already names the agent and a global number is the one that works in
conversation ("look at #12").

## D9. Validation and the test message

**Decision**: a bot token must match `^xoxb-[A-Za-z0-9-]+$` (a bot *user*
token; user tokens `xoxp-` are refused with a message saying which one is
needed); a channel id must match `^[CG][A-Z0-9]{8,}$`. The test posts
`renderTest()` to the channel with `chat.postMessage` — no thread, no
reaction (FR-026) — and maps Slack's answer to words
([contracts/slack-bot.md](contracts/slack-bot.md#errors)).

**Rationale**: shape checks catch a pasted webhook address or a user token
before anything is stored; the test is the real proof, as for the webhook.

## D10. Which Slack errors are retried

Decided per call; the table is the contract
([contracts/slack-bot.md](contracts/slack-bot.md#errors)). In short:
network and 429 retry on the existing schedule; `invalid_auth`,
`token_revoked`, `account_inactive`, `channel_not_found`, `not_in_channel`,
`is_archived` fail the delivery and surface on the destination as the words
the owner needs; `message_not_found`, `cant_update_message`,
`edit_window_closed`, `already_reacted`, `no_reaction` are side-effect
outcomes of a rewrite or a reaction and never fail the delivery they rode on.

## D11. The console and the tools

**Decision**: Settings → Notifications gets a kind choice above the form; the
bot form has two fields and its own guide (token, the two permissions,
invite, channel id — the steps the owner actually went through). The store's
`saveDestination` takes `{ kind, webhookUrl? , botToken?, channelId? }`.
`set_notification_destination` takes the same; `get_notification_destination`
and the view DTO return `kind`, `channelId`, `hint`, never a secret. The
incident list, the agent's Events tab and `list_agent_incidents` show
`number`. No new tool: the four destination tools and the incident tool cover
every new console capability (Principle V).

**Twin console**: `agent` is a twin slice, but its `event` sub-slice exists
in `admin` only (CLEAN-139 D14; `app/` has no notification settings and no
incident list). Verified again for this plan: `grep -r agentEvent app/slices`
finds nothing. Nothing to mirror.

## D12. What the webhook keeps

**Decision**: with `kind = 'webhook'` the worker delivers `opened` and
`closed` exactly as today (`renderOpened`, `renderClosed`, same text) and
never sees `joined` / `running` rows (D5). SC-004 is checked by the existing
`notificationText.spec.ts` snapshots, untouched.
