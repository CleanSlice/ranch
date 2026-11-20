# Contract: agent tools (CLEAN-240)

Per docs/agent-tools.md: in the slice, with `topic` / `title` / `template` /
`effect`, an audience, `confirm` where destructive, a spec each. Topic for all:
`users_keys`.

| Tool | Audience | Effect | Does |
|---|---|---|---|
| `get_assistant_access` | `owner` | read | The overview: both roles, the exceptions. |
| `set_assistant_role_access` | `owner` | write, destructive | `{ role, enabled?, level?, on?, confirm? }`. Without `confirm`, when the change removes abilities from anyone, answers who loses what (counts per area, number of accounts) and changes nothing. |
| `get_user_assistant_access` | `admin` | read | One account: resolved setting, where it comes from. An Admin gets it only for accounts they may edit. |
| `set_user_assistant_access` | `admin` | write, destructive | `{ userId, enabled?, level?, on?, confirm? }`. Same refusals as the route (Owner target, self, Admin by Admin, above the editor's own). Same confirm rule. |
| `reset_user_assistant_access` | `admin` | write | Drops the exception. |
| `get_my_assistant_access` | `person` | read | The caller's own level, areas, and the titles of abilities their role has and their setting leaves out. Always listed for a person, at every level, including when everything else is off. |

Explaining levels: `get_assistant_access` and `get_my_assistant_access` both
return a `levels` section ([acting.md](./acting.md), "Where the level
definitions come from") — the first for both roles, the second for the
caller's role only. It is built from the rule the API enforces, so the
assistant never explains a level from memory.

Rules:

- The party is `callerParty(httpRequest)`, never the agent's token.
- `get_my_assistant_access` is excluded from the grant: no setting can switch
  it off.
- No tool reads or sets the assistant through the agent lists
  (`set_user_agent_access` refuses the assistant's id, as the route does).
- Results carry no email of other accounts beyond what `list_users` already
  shows the same caller.

Changed tools: every existing `@Tool` gains `effect`. `set_user_agent_access`
and `get_user_agent_access` stop naming the assistant.
