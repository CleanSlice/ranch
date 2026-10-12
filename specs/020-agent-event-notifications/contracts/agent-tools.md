# Contract: Agent Tools for Events and Notifications

**Covers**: FR-030, Constitution V, `docs/agent-tools.md`.

One class, one audience: `AgentEventTool` in
`api/src/slices/agent/event/agentEvent.tool.ts`, operator only
(`isListedForRequest → callerIsOperator(req)`, `requireOperator` in every
method). It injects the same services the controllers use.

| Console can… | Tool | Topic | Destructive |
|--------------|------|-------|-------------|
| list events | `list_agent_events` | `agents` | no |
| list incidents | `list_agent_incidents` | `agents` | no |
| see the destination | `get_notification_destination` | `settings` | no |
| set the destination | `set_notification_destination` | `settings` | no — takes a secret |
| send a test | `send_test_notification` | `settings` | no |
| remove the destination | `remove_notification_destination` | `settings` | **yes**, `confirm` |
| create / revoke a sender key | existing `create_api_key`, `revoke_api_key` | `users_keys` | (unchanged) |

## Metadata

```ts
{ name: 'list_agent_events',
  title: 'List agent events',
  template: 'Show what happened to «agent name» since «when»' }

{ name: 'list_agent_incidents',
  title: 'List agent incidents',
  template: 'Which agents went down since «when», and are any still down?' }

{ name: 'get_notification_destination',
  title: 'Show where failure notifications go',
  template: 'Where do agent failure notifications go, and did the last one arrive?' }

{ name: 'set_notification_destination',
  title: 'Set the Slack address for notifications',
  template: 'Send agent failure notifications to the Slack webhook «address»' }

{ name: 'send_test_notification',
  title: 'Send a test notification',
  template: 'Send a test notification to the team chat' }

{ name: 'remove_notification_destination',
  title: 'Stop sending notifications',
  template: 'Stop sending agent failure notifications to Slack',
  destructive: true }
```

## Parameters and results

- `list_agent_events { agentId?, since?, limit? }` → the fields of
  `AgentEventDto` ([console-api.md](console-api.md)). The description says:
  "call `list_agents` to find the id".
- `list_agent_incidents { agentId?, state?, since?, limit? }` →
  `AgentIncidentDto`, including each notification's delivery state.
- `get_notification_destination {}` → the `GET /agent-events/destination`
  shape. Never the address.
- `set_notification_destination { webhookUrl }` → `{ configured: true, hint }`.
  Acknowledges without echoing the value. Refuses a non-Slack address with the
  reason.
- `send_test_notification {}` → `{ delivered, error }`; with no destination
  set, says so and names `set_notification_destination`.
- `remove_notification_destination { confirm }` → refuses without `confirm`
  and touches nothing; the description ends with `CONFIRM_SENTENCE`.

## Existing tool that changes

`create_api_key` (`api/src/slices/user/apiKey/apiKey.tool.ts`): the scope
schema is `z.nativeEnum(ApiKeyScopeTypes)`, so the new value is accepted once
the enum has it; its description gains "`events:write` — post agent events
(`POST /agent-events`) and nothing else".

## Tests

`agentEvent.tool.spec.ts`, in the style of `peerAdmin.tool.spec.ts`:

- listed for the operator, not listed for an agent runtime or a plain user;
- one happy path per tool, asserting the service call and the result;
- `list_agent_events` for an unknown agent id → "not found — call list_agents";
- `remove_notification_destination` without `confirm` → refusal, no service call;
- no tool result contains the webhook address.

`api/src/slices/mcp/tool-secrets.spec.ts`: add
`set_notification_destination` with the sentinel in `webhookUrl`.
