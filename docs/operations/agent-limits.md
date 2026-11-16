# Request limits for agents

How many requests an agent takes per minute, hour and day, what that number
does and does not cover, and what to look at when one is hit. Introduced in
CLEAN-224; spec in `specs/030-agent-request-limits/`.

## What a limit is

One allowance per agent, shared by everyone who talks to it. Up to three
limits — per minute, per hour, per day — each over a window that moves with
time: "20 per minute" means no more than 20 in *any* sixty seconds, not in the
minute that started at :00.

Limits are **off by default** for every agent. A **public** agent must have at
least one: the console refuses to make an agent public without a limit and
refuses to remove the last limit from a public one. A private agent may have
them or not.

An agent that was public before limits existed keeps working uncapped. It is
marked "public without limits" in the agent list and on its page, and the next
save of its visibility settings requires limits. It can still be renamed or
otherwise edited in the meantime.

Set them in the admin console: an agent → **Visibility & embed**. Or ask the
Ranch agent, which has a tool for each thing that card and the load view do:

| Ask | Tool | What it does |
|-----|------|--------------|
| "Which agents are at their limit right now?", "which public agents have no limits?" | `list_agent_limits` | Every agent by name: public or not, limits on or off and their values, at its limit right now, public without limits |
| "What are the limits on Support, and how busy is it?" | `get_agent_limits` | One agent's limits and load: usage per window, in progress, refusals in the last hour by window and when the latest was, traffic that is not counted, the minutes of the last hour that saw traffic, 30-day peaks |
| "Set 30 per minute on Support" | `set_agent_limits` | Replaces the three limits; all empty switches them off |
| "Make Support public for https://shop.example.com with 30 per minute", "make Support private" | `set_agent_visibility` | The public flag, the allowed origins and, if named, the limits, in one save |

Through the chat, loosening or removing a limit asks for confirmation, and so
does making a private agent public; tightening a limit and making an agent
private do not. Going public without a limit is refused, as in the console.
`set_agent_visibility` restarts nothing: when the public flag or the origins
changed it says a restart is suggested, the way the console shows "restart
pending" after the same save.

These tools belong to the Ranch admin agent, whose token carries Owner. An
Admin has the same capabilities in the console, not through the tools.

## What counts

A request is one message that the platform accepted for delivery to the agent,
whichever way it arrived: the embed widget, the landing page chat, a share
link, the app console, or the two HTTP message routes.

Not counted, and never refused:

- **Operators** — a signed-in Owner or Admin, from either console. They have
  to be able to reach an agent that is at its limit, to test it and to fix it.
- **Other agents** delegating a task. Agent-to-agent traffic has its own chain
  limit, and refusing it mid-task would break the calling agent's answer.

Both are shown in the load view as traffic that is not counted.

Not seen by the platform at all, so **not covered by these limits**:

- **Telegram.** The agent talks to Telegram by itself.
- **The agent's own scheduled runs.**

Also not counted: a message to an agent that is offline (it is refused as
offline), and a resend of a message that was already accepted.

## What a person sees

A notice on the message field: "This agent has reached its message limit. Try
again in 0:42." Their text stays in the field and they can keep editing it.
Nothing is sent by itself when the wait ends. When an hour or day limit is
already full, the notice is there as soon as the chat opens; a full minute
limit shows only after a refused send.

The notice never shows the limit, the usage, or how many people are talking to
the agent. Embedded sites need the widget from 0.16.0 for it; older widgets
get a plain line in the conversation instead.

An integration calling the HTTP routes gets `429` with `Retry-After` (seconds)
and `{ "code": "RATE_LIMITED", "retryAfterSec", "window" }`. A caller that
presented a credential also gets `X-RateLimit-Remaining` and
`X-RateLimit-Reset` on successful calls.

## Reading the load view

On the agent's page, updated every few seconds while the page is visible:

- **Meters** — used against the limit, per window; "room again in …" when one
  is full. For a window with no limit the figure has no ceiling.
- **In progress** — conversations waiting for an answer right now. This, not
  requests per minute, is what says the agent itself is the bottleneck: a high
  figure with meters far from full means the agent is slow, and a looser limit
  will not help.
- **Last hour** — accepted and refused per minute.
- **Refused** — how many in the last hour, by the window that caused them, and
  when the latest was.
- **Highest seen** — the busiest minute, hour and day of the last 30 days,
  shown next to the limit fields. A reasonable first limit is somewhat above
  the highest value seen on a normal day.

One sender can use up the whole allowance — that is the accepted cost of a
shared one. It shows as a burst in the last-hour chart. The remedy is a tighter
minute limit against a looser day limit.

## Things to know

- **A restart does not reset the day.** Counts are written to the database
  every ten seconds and on shutdown, and rebuilt at boot. After a restart the
  wait reported for requests accepted before it may be overstated by up to a
  minute; it is never understated.
- **Counting assumes one copy of the API.** With more than one, each would
  grant the full allowance. The API warns in its log and the load view says
  its figures are partial. Production runs one copy on purpose (CLEAN-140).
- **Changing a limit takes effect on the next request** and keeps what was
  used so far. Raising or removing one clears the notice in open chats.
- **Limit values are for Owners and Admins.** They are deliberately not part
  of the agent record, which is readable in places they must not reach
  (CLEAN-225). Any signed-in user can learn only whether an agent has limits.
- The anonymous HTTP message routes still accept calls for private agents
  (CLEAN-226). Once an agent has limits those calls are counted like any
  visitor's.
