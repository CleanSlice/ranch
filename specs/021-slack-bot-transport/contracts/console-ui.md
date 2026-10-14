# Contract: Console UI (admin)

**Feature**: [spec.md](../spec.md) | **Research**: [D11](../research.md#d11-the-console-and-the-tools)

`admin` only; English only. `app` has no twin of `agent/event` (research D11).

## Settings → Notifications (`pages/settings/notifications.vue`)

Above the form, a choice of transport — two options, a short line under each:

```text
( ) Incoming webhook   One message when an incident opens, one when it closes.
(•) Slack bot          One message per incident; its story in the thread; the
                       state as a reaction. Needs a bot token and a channel.
```

- Owner can change the choice; Admin sees it disabled (`canEdit` as today).
- Picking a kind shows that kind's form. Switching with a configured
  destination of the other kind shows a note: "Saving replaces the
  <other> destination."

### Bot form (`destination/BotForm.vue`)

| Field | Rules | Note under it |
|-------|-------|---------------|
| Bot token | password field; placeholder `xoxb-…`; required | "A secret: stored, never shown again. Last four characters: `…a1b2`" once set |
| Channel id | text; placeholder `C0…`; required | "Channel → About → Channel ID" |

Buttons as today: Save / Replace / Remove (confirm) / Send test. The
`lastDelivery` line shows the words of
[slack-bot.md#errors](slack-bot.md#errors) when the last delivery failed.

### Bot guide (`destination/BotGuide.vue`)

Shown under the bot's fields while the bot kind is selected. (`SenderGuide`
is about the senders — DevOps posting events — and stays on the page
whatever the transport; the first draft of this contract had it replaced,
which was wrong.) Four numbered steps, as the owner did them on 2026-10-14:

1. api.slack.com/apps → your app → OAuth & Permissions → Bot Token Scopes:
   add `chat:write` and `reactions:write`.
2. Reinstall to Workspace; copy the Bot User OAuth Token (`xoxb-…`).
3. In Slack, invite the bot to the alerts channel (`/invite @<bot>`); a
   reinstall with new scopes needs this again.
4. Channel → About → Channel ID (`C0…`).

The webhook guide stays as it is for the webhook kind.

## Events page and the agent's Events tab

- Incident rows show `#<number>` before the state badge; the expandable
  row's title is `#<number> · <agent name>`.
- The incident search on loaded rows also matches `#<number>`.

## Store (`stores/agentEvent.ts`)

`saveDestination(input: ISaveDestination)` where
`ISaveDestination = { kind: 'webhook'; webhookUrl } | { kind: 'bot'; botToken; channelId }`.
The store keeps nothing of the input after the call; `destination` is what
the server answered. `IAgentIncident.number: number`.
