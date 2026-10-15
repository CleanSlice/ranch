# Contract: Console API and Agent Tools

**Feature**: [spec.md](../spec.md) | **Research**: [D2](../research.md#d2-one-destination-row-a-kind-nullable-secrets), [D11](../research.md#d11-the-console-and-the-tools)

Routes, guards and roles are CLEAN-139's ([console-api](../../020-agent-event-notifications/contracts/console-api.md)); only bodies change. Generated SDK:
`cd api && bun run build && bun run generate:swagger`, then
`cd admin && bun run build:api`.

## `PUT /agent-events/destination` — Owner

Body (`SaveNotificationDestinationDto`):

```jsonc
{ "kind": "webhook", "webhookUrl": "https://hooks.slack.com/services/…" }
{ "kind": "bot", "botToken": "xoxb-…", "channelId": "C0…" }
```

- `kind` required, `webhook` | `bot`.
- `webhookUrl` required when `kind = webhook` (rules as today), ignored otherwise.
- `botToken` (`^xoxb-[A-Za-z0-9-]+$`, ≤ 300) and `channelId`
  (`^[CG][A-Z0-9]{8,}$`) required when `kind = bot`.
- 400 names the field; a `xoxp-` token gets "a bot token (xoxb-…) is needed, not a user token".

Answer: `NotificationDestinationDto` below. Saving replaces the row and nulls
the other kind's secret.

## `GET /agent-events/destination` — Owner, Admin

`NotificationDestinationDto`:

```jsonc
{
  "configured": true,
  "kind": "bot",                 // "webhook" | "bot" | null
  "hint": "a1b2",                // last 4 of the secret that is set
  "channelId": "C0…",            // bot only, else null
  "updatedBy": "<userId>", "updatedAt": "…",
  "consoleLinks": true,
  "lastDelivery": { "at": "…", "ok": false, "error": "The bot is not in the channel — invite it" } | null
}
```

Never `webhookUrl`, never `botToken`. Clients that still read `kind ==
"slack"` must read `"webhook"`: the admin store is the only one and is
updated with this feature.

## `POST /agent-events/destination/test` — Owner

Unchanged shape (`TestDeliveryDto`); on the bot kind it posts the test
message to the channel (no thread, no reaction) and maps Slack's answer to
the words in [slack-bot.md#errors](slack-bot.md#errors).

## `DELETE /agent-events/destination` — Owner

Unchanged. Also marks pending messages skipped, as today.

## `GET /agent-incidents` — Owner, Admin

Each item gains `"number": 12`. Order and paging unchanged.

## Agent tools (`agentEvent.tool.ts`)

| Tool | Change |
|------|--------|
| `set_notification_destination` | args `{ kind: 'webhook' \| 'bot', webhookUrl?, botToken?, channelId? }`; result = the view (no secret); description says which fields each kind needs and that the token is never shown again |
| `get_notification_destination` | result gains `kind`, `channelId` |
| `send_test_notification` | unchanged; on the bot kind the words of the error table |
| `remove_notification_destination` | unchanged (`confirm`) |
| `list_agent_incidents` | each incident gains `number` |

Audience and `confirm` rules unchanged (Owner only for the four destination
tools). `tool-secrets.spec.ts` gains `botToken` to its sentinel check.
