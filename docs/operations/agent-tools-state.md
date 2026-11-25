# Tool servers: connecting, limited, refused

An agent's tools come from tool servers (MCP): Ranch's own, Documents, the
ones a template adds. Since runtime 0.40 a server that is not there is tried
again for as long as the agent runs, and the agent says which ones it is
waiting for. This page is what those words mean and what to do about them
(CLEAN-245).

## What the consoles say

| The agent's tools | When | What a person sees |
|---|---|---|
| **connecting** | A server is missing and the runtime started less than `MCP_START_GRACE_MS` ago | "Connecting tools…" with the server and the attempt. A message written now waits in the chat's queue. |
| **limited** | A server is still missing after that, or one dropped and stayed away | "Limited tools": the agent answers with what it has. Messages are delivered. |
| ready | Every server is connected | Nothing. |

A server is in one of three states:

- `connected`.
- `retrying`: it did not answer, or answered with an error that may pass. The
  runtime waits 5, 10, 20, 40 seconds and then `MCP_RETRY_MAX_MS` between
  attempts, without end.
- `refused`: it answered 401 or 403. The credentials the agent holds for it
  are wrong, and waiting does not fix a credential: the runtime does not try
  that server again. **This one needs a person**: fix the server's
  credentials (MCP servers, or the template's secret), then restart the
  agent.

Owners and Admins see the server's name, its state and the attempt count: in
the chat, on the agent's Overview, and from `GET /agents/:id/tool-state`,
which also carries the last error. Users and share-link visitors are told
only that part of the assistant's knowledge is unavailable for now: no server
name reaches their browser. The Ranch agent answers the same question through
`get_agent_status` (`tools`).

A runtime older than 0.40 reports nothing: no line, no badge, and the status
line of before. Nothing here needs it to be upgraded first.

## The incident

An agent that stays `limited` for `TOOLS_LIMITED_ALERT_MS` opens an incident
on the Events page with the status **Limited tools** and a reason such as
"Documents not connected for 5 min": server names and a duration, never the
error text. While it lasts, the report repeats every five minutes into the
same incident. When the tools are back the incident is marked up and closes
the way every incident does ([agent-events.md](agent-events.md)).

No incident opens for an agent that is `stopped`, `pending` or `deploying`:
it is not expected to have its tools. The time is counted in the API's
memory, so an API restart starts the count again, and with more than one
copy of the API alive each counts for the agents connected to it.

## Settings

| Variable | Where | Default | What it is |
|---|---|---|---|
| `MCP_START_GRACE_MS` | runtime (agent pod) | 60000 | How long after start a missing server reads as `connecting` rather than `limited` |
| `MCP_RETRY_MAX_MS` | runtime (agent pod) | 60000 | The longest pause between two attempts |
| `TOOLS_LIMITED_ALERT_MS` | API | 300000 | How long an agent may stay `limited` before the incident opens |

## When it does not clear

1. Agent → Overview: which server, `retrying` or `refused`.
2. `retrying`: is the server up, and reachable from the agents' namespace?
   The last error is in `GET /agents/:id/tool-state` and in the Ranch agent's
   answer. Nothing has to be restarted once it is back: the next attempt
   connects, at most `MCP_RETRY_MAX_MS` later.
3. `refused`: fix the credentials, restart the agent.
4. A server that signs in through OAuth is not in this list yet: the runtime
   does not report on it.
