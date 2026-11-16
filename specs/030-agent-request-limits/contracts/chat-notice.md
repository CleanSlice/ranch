# Contract: the notice and the operator's screens

What the browser tests hold on to. Behaviour is specified in spec.md, *The
notice in the chat*; this file fixes names, states and hooks.

## Limit notice (app console: chat, landing chat, share page)

Component `LimitNotice` in `app/slices/bridle/components/bridle/chat/`,
rendered by every composer that can send to an agent, driven by
`bridleStore.limits[agentId]`.

| Hook | On | Value |
|------|----|-------|
| `data-limit-notice` | the notice root | present while limited or while saying "you can send now" |
| `data-limit-state` | the notice root | `waiting` \| `ready` |
| `data-limit-window` | the notice root | `minute` \| `hour` \| `day` |
| `data-limit-time` | the element holding the time | the text shown (`0:42`, `14:30`) |
| `data-limit-nudge` | the notice root | set for the length of the nudge animation after a blocked Enter |
| `aria-disabled="true"` + `aria-describedby` → notice | Send button, suggestion chips, form submit | while `waiting` |

States:

```text
(none) ──refused send / agent_limit{limited:true}──▶ waiting
waiting ──until passes──▶ ready ──2 s──▶ (none)
waiting ──agent_limit{limited:false}──▶ (none)
waiting ──refused again──▶ waiting (new until)
```

- `role="status"`, `aria-live="polite"`, `aria-atomic="true"` on the two text
  lines; the ticking time sits in an `aria-hidden` element with a non-ticking
  text alternative, so it is read once.
- The shrinking line is hidden under `prefers-reduced-motion: reduce`.
- 2 s for `ready` is long enough to read five words and short enough not to
  sit on the composer; it is the only timing here that is a choice.

### Text (i18n keys, `app/slices/bridle/i18n/locales/en.json`, `ru` generated)

| Key | English |
|-----|---------|
| `bridle.limit.reached` | This agent has reached its message limit. |
| `bridle.limit.retryIn` | Try again in {time}. |
| `bridle.limit.retryAfter` | Try again after {time}. |
| `bridle.limit.retryTomorrow` | Try again tomorrow after {time}. |
| `bridle.limit.ready` | You can send your message now. |
| `bridle.limit.sendDisabled` | Sending is paused until the agent has room again. |

`{time}`: under an hour, `m:ss` from the remaining duration; otherwise the
time of day through `useFormat()`. Never `toLocale*String` or `Intl.*` in the
component (`bun run locale:check`).

## Operator's line (admin console chat)

In `admin/slices/bridle/components/bridle/Provider.vue`, above the input,
while `bridleStore.visitorLimits[agentId]` is set:

> Visitors are being asked to wait — this agent is at its message limit. Your
> messages are not limited. [Limits]

Hook `data-visitor-limit-line`. English, admin clock is 24-hour. The link goes
to the agent's "Visibility & embed" card.

## "Visibility & embed" card (admin)

| Hook | Element |
|------|---------|
| `data-visibility-public` | the Public / Private switch |
| `data-limit-input="minute" \| "hour" \| "day"` | the three number fields |
| `data-limit-peak="minute" \| "hour" \| "day"` | "highest seen in 30 days" next to each field |
| `data-limits-error` | the refusal text of a save |
| `data-limits-uncovered` | the line listing what limits do not cover (operators, agent-to-agent, Telegram, scheduled runs) |
| `data-limits-share-warning` | private + active share link + no limits |

One Save for switch, origins and limits. Refusal codes from `http-api.md` map
to sentences next to the field they concern.

## Load view (admin, agent page)

| Hook | Element |
|------|---------|
| `data-load-window="minute" \| "hour" \| "day"` | a meter; `data-used`, `data-limit` (empty when not limited) |
| `data-load-inflight` | requests in progress |
| `data-load-chart` | the last-hour chart; each bar `data-minute`, `data-accepted`, `data-refused` |
| `data-load-refused` | refused in the last hour, with the time of the latest |
| `data-load-exempt` | operator and agent-to-agent traffic, marked "not counted" |
| `data-load-partial` | shown when `apiReplicas > 1` |

## Agent list marks (admin)

`data-agent-at-limit` and `data-agent-needs-limits` on the row, each with a
text label, not colour alone.

## App console sheet

`data-limits-enabled="true" | "false"` on the read-only visibility line.
