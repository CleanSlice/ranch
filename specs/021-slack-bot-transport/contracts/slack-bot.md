# Contract: What the Bot Sends to Slack

**Feature**: [spec.md](../spec.md) | **Research**: [D1](../research.md#d1-the-web-api-is-called-with-fetch-no-slack-sdk), [D3](../research.md#d3-a-second-port-for-the-bot-the-webhook-port-untouched), [D10](../research.md#d10-which-slack-errors-are-retried)

All calls: `POST https://slack.com/api/<method>`, header
`Authorization: Bearer <botToken>`, `Content-Type: application/json;
charset=utf-8`, 5 s timeout (today's `NOTIFY_TIMEOUT_MS`). The answer is
`{ ok: boolean, error?: string, ts?: string }`; an HTTP 429 carries
`Retry-After` in seconds.

## Calls

| Purpose | Method | Body |
|---------|--------|------|
| root (opening) | `chat.postMessage` | `{ channel, text, blocks, unfurl_links: false }` |
| thread reply | `chat.postMessage` | `{ channel, thread_ts: <root ts>, text, blocks }` |
| rewrite root | `chat.update` | `{ channel, ts: <root ts>, text, blocks }` |
| reaction swap | `reactions.remove` then `reactions.add` | `{ channel, timestamp: <root ts>, name }` |
| test | `chat.postMessage` | `{ channel, text, blocks }` — `renderTest()` as today |

`text` is the plain fallback (lock screen, search); `blocks` is one
`section` with `mrkdwn`, as the webhook messages are. Every piece of text a
sender supplied is escaped (`& < >`) before it is placed, as today; the
channel mention `<!channel>` is ours and sits outside it.

## Messages

Times are `<!date^<unix>^{date_short_pretty} at {time}|<iso>>` so Slack
shows them in the reader's zone — the webhook's `slackDate()` reused.
`<name>` is the agent's name as it was when the incident opened. `<link>` is
`<ADMIN_URL>/agents/<agentId>?tab=events`, omitted when `ADMIN_URL` is unset.

### Root — first version (the only one with a mention)

```text
🔴 <!channel> *<name> — incident #<number> · down since <openedAt> · <reason, cut to 80>*
<link|Open in Ranch>
```

### Root — every rewrite (no mention)

```text
🔴 *<name> — incident #<n> · down since <openedAt> · <reason> · <count> reports*
🟢 *<name> — incident #<n> · up, watching since <upSince> · <reason> · <count> reports*
✅ *<name> — incident #<n> · resolved <closedAt> · downtime <span> · <count> reports*
🟢 *<name> — incident #<n> · quiet since <lastFailureAt>, unconfirmed · <count> reports*
⏹ *<name> — incident #<n> · stopped by owner <closedAt> · <count> reports*
⏹ *<name> — incident #<n> · deleted <closedAt> · <count> reports*
<link|Open in Ranch>
```

`· <count> reports` appears from the second report on. The leading emoji is
always the same as the bot's reaction (data-model: *Root state*).

### Thread replies — one per outbox row, in `seq` order

```text
opened   🔴 *Failed* — <occurredAt>
         *Cause:* <reason>
         *Reported by:* <senderName> (via <tool>) | Ranch (its own watch)
         *Ranch sees:* <ranchStatus> [— the two disagree]        (outside reports only)

joined   🔴 *Failed again* — <occurredAt>
         *Cause:* <reason>
         *Reported by:* … · <eventCount> reports so far

running  🟢 *Running again* — <at>
         Seen by Ranch. The incident closes after 10 quiet minutes.

closed   ✅ *Resolved* — <closedAt>
         Down for <span> (<openedAt> → <upAt>), up and stable for 10 min.
       | 🟢 *No further reports* — <closedAt>
         <firstSender> reported a failure at <openedAt>. Ranch saw the agent running throughout, and nothing more has been reported for 10 min.
       | ⏹ *Stopped by owner* — <closedAt>
         Incident closed, nobody was paged.
       | ⏹ *Deleted* — <closedAt>
         The agent was deleted; incident closed, nobody was paged.
```

No reply ever contains `<!channel>` or `<!here>`.

## One delivery, step by step (bot transport)

```text
opened:   [slackTs unset] chat.postMessage(root, mention)  → incident.slackTs, slackChannel
          reactions.add(red_circle)                         → incident.slackReaction
          chat.postMessage(thread: Failed)
joined:   chat.postMessage(thread: Failed again)
          chat.update(root rendered from the incident now)
running:  chat.postMessage(thread: Running again)
          chat.update(root) · reactions swap → large_green_circle
closed:   chat.postMessage(thread: Resolved | No further reports | Stopped | Deleted)
          chat.update(root) · reactions swap → white_check_mark | large_green_circle | black_square_for_stop
sweep:    for every open bot incident with rootStale: chat.update(root); rootStale = false
```

The thread reply is *the* delivery: its failure retries the row. The rewrite
and the reaction are side effects: their failure is recorded on the
destination's last delivery and the row is still marked sent. A row is not
claimed while an earlier `seq` of its incident is still pending, so a thread
never shows "Resolved" above "Failed again".

## Errors

| Slack says | Delivery | Shown to the owner as |
|------------|----------|-----------------------|
| network error, timeout | retry (schedule as today) | "could not reach Slack" / "Slack did not answer within 5 s" |
| HTTP 429 / `ratelimited` | retry after `Retry-After` | "Slack answered 429" |
| `invalid_auth`, `not_authed`, `token_revoked`, `account_inactive` | fail, no retry | "The bot token is not valid — paste a new one" |
| `missing_scope` | fail, no retry | "The bot lacks a permission: <needed>" |
| `channel_not_found` | fail, no retry | "No channel with this id" |
| `not_in_channel` | fail, no retry | "The bot is not in the channel — invite it (/invite @Ranch Alerts)" |
| `is_archived` | fail, no retry | "The channel is archived" |
| `message_not_found`, `cant_update_message`, `edit_window_closed` | side effect dropped; delivery still sent | "Could not update the incident message: <error>" |
| `already_reacted`, `no_reaction` | ignored | — |
| anything else | fail, no retry | "Slack answered: <error>" |

The token never appears in an error, a log line or a stored message: the
notifier scrubs it from any body it quotes, as the webhook notifier scrubs
the address.
