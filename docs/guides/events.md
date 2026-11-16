# Events and notifications

When an agent goes down the team is told in Slack, and the admin console
keeps the record under **Events**. A failure is witnessed by Ranch's own
watch, by an outside sender, or by both: cluster tooling can report one with
`POST /agent-events` and an API key that carries only the `events:write`
scope. An outside event never changes an agent's status. Two ways to be
told, chosen under **Settings → Notifications**: a Slack bot keeps one
message per incident (`#12`), rewritten as it moves, with every event as a
reply in its thread and the state as a reaction; an incoming webhook posts
one message when the incident opens and one when it closes. With
`RANCH_ENVIRONMENT` set on the API, every message starts with the
installation's name in brackets. The owner's and the sender's guide is
`docs/operations/agent-events.md`; the rules are in
`specs/020-agent-event-notifications/` and `specs/021-slack-bot-transport/`.
