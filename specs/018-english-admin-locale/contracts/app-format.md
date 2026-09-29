# Contract: app value formats and interface text

What a customer sees in the customer console. The language is the console's
**active language**: the one picked in the switcher, or on a first visit the
offered language matching the browser, English otherwise.

Everything below follows the active language and changes when it changes,
without a reload.

## Values

Each language uses its own conventions — app does not impose one clock or one
date order. The reference instant is 21 August 2026, 00:46 local time.

| Kind | English | Russian | Used for |
|------|---------|---------|----------|
| Date | `8/21/2026` | `21.08.2026` | "shared since" on a share link |
| Date and time | `8/21/2026, 12:46:00 AM` | `21.08.2026, 00:46:00` | chat detail |
| Time of day | `12:46 AM` | `00:46` | message sent today, proposal acted on |
| Message time | `12:46 AM` today · `Aug 21, 12:46 AM` earlier | `00:46` · `21 авг., 00:46` | transcript |
| Message tooltip | `August 21, 2026 at 12:46:00 AM` | `21 августа 2026 г. в 00:46:00` | hover on a message time |
| Day divider | `August 21, 2026` | `21 августа 2026 г.` | line between days in a chat |
| Day, in full | `Friday, August 21, 2026` | `пятница, 21 августа 2026 г.` | the day label while scrolling a chat |
| Relative time | `5m ago` | `5 мин назад` | rail, chat list — existing keys, unchanged |
| Count | `12,345` | `12 345` | messages, changed lines, additions |
| Percent | `42%` | `42 %` | upload progress |
| Size | `856 B` · `2 KB` · `5.9 MB` | `856 Б` · `2 КБ` · `5,9 МБ` | attachments, size limits |
| Size, small files | `2.1 KB` | `2,1 КБ` | proposals, as before |
| Language name | `Ukrainian` | `украинский` | the chat's detected language |

These are the formats app shows **today** in each language, kept as they are.
The change is that sizes, counts and percent join them.

## Values from a closed list

A value the console knows is rendered through translation. One it does not know
— the API can add them — is received text and is shown as received.

| Value | Set | Outside the set |
|-------|-----|-----------------|
| Agent status | `running` · `pending` · `deploying` · `failed` · `stopped` | as received |
| Proposal mode | `merge` · `replace` | as received |
| Proposal row action | `add` · `change` · `unchanged` · `remove` · `skip` | as received |
| User role | the roles the API defines | as received |
| Chat sentiment | `positive` · `neutral` · `negative` · `mixed` | `neutral` (the mapper already normalises) |

## Messages that come from the server

Shown as received, in every language. The console translates only its own
words.

| Situation | What the customer sees |
|-----------|------------------------|
| The server sent a sentence (a refusal reason, a delivery error, a sign-in error) | the console's line in the active language, with the server's sentence exactly as received |
| The server sent nothing to quote (network down, no message in the response) | the console's own message, in the active language |
| Agent restart failed | the console's line in the active language, followed by the transport detail as received |
| A machine code shown for support (`AGENT_OFFLINE`) | as is |

A Russian screen can therefore carry an English sentence. That is decided: the
sentence is what support and the logs know it by.

## Left exactly as written

- Chat messages, agent replies, the agent's reasoning steps.
- Reasons, error details and log lines received from the server.
- File names, agent names, template descriptions, chat summaries and topics.
- Kubernetes quantities (`500m`, `512Mi`) — identifiers, not prose.
- Key caps (`Enter`, `Shift+Enter`) — the label printed on the key.
- Export format names (`MD`, `JSON`, `CSV`).
- Proper names on the landing page.

Each of these is an entry in the check's allowlist with this reason, not an
unexplained exception.

## Sentences are not assembled in code

A sentence whose parts are joined in a template or a script fixes the word order
for every language. Two places do this today (an attachment tooltip, the upload
progress line); each becomes one message with named placeholders.

## Rule L5 — what the check enforces here

A finding in `app/slices/**/*.vue` is:

- a text node in the template that contains a letter and is not inside an
  interpolation;
- a static `placeholder`, `title`, `aria-label`, `alt` or `label` attribute
  whose value contains a letter.

The check does not see a raw value rendered through `{{ agent.status }}` or a
sentence chosen in script. Those are covered by the rules above and by the
tests of the components that render them; `docs/i18n.md` says which is which.

## The page itself

`<html lang>` carries the active language and changes with it.
