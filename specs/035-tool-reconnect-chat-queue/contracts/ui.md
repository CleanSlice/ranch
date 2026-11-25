# Contract: consoles

Both consoles and the share page. `admin` strings are the literals below; `app` strings are `en.json` keys with these as the source text.

## Start-up line and limited mark

| State | `admin` (manager) | `app` User / share visitor |
|---|---|---|
| pod not ready | as today ("Starting agent…", pod detail) | as today |
| on the hub, `tools: connecting` | **Connecting tools…** · detail: "Documents is not answering yet — trying again (attempt 3, 40 s)." | **Starting — almost ready…** |
| `tools: limited` | badge **Limited tools** beside Running; chat line: "Running without Documents — still trying to reconnect." or "…— refused, check its credentials." | one quiet line above the composer: **Part of this assistant's knowledge is temporarily unavailable.** |
| ready | as today | as today |

- Detail (names, attempts, error) is read from `GET /agents/:id/tool-state` only when the summary is not null, and only by a console whose user manages the agent. An Admin or Owner in `app` sees the manager wording.
- The mark appears in: the chat status line, the agent header dot's tooltip, the rail / agents list row. One derivation per console (`agent/utils/toolState.ts`), fed by the agent record.
- `admin` takes the summary from the status stream frame; `app` from `AgentDto.toolState` on its existing poll and from the hub's `agent_status` inside an open chat.
- It clears without a reload when the summary returns to null.
- `app` gains the missing `status.unreachable` label while its status keys are being touched.

## Composer

- Never disabled for agent state. It is disabled only when the person may not write to this agent at all (share link revoked, access removed).
- Send, when `canTake` is true and the queue is empty → sent as today.
- Send, otherwise → queued. The input clears. Staged attachments move with the message.
- Send with three already queued → nothing is queued, the text stays, one line under the input: "Three messages are already waiting. Remove one or wait for the agent." (`aria-live="polite"`).
- A message cannot be queued while one of its attachments is still uploading or failed — the same rule as sending.
- The `app` request-limit wait keeps its own behaviour: nothing is queued or drained while it is waiting.

## Queue panel

Directly above the composer, same width, only when the queue is not empty.

```text
┌──────────────────────────────────────────────────────────────┐
│ Queued · 2                                                 ⌄ │
├──────────────────────────────────────────────────────────────┤
│ ⠿  check the CX-90 towing capacity                 ✎   🗑   ⋯ │
│ ⠿  and compare it with the 2024 model  📎 1        ✎   🗑   ⋯ │
└──────────────────────────────────────────────────────────────┘
```

| Control | Action |
|---|---|
| header chevron | fold to the header / unfold; remembered per conversation for the session |
| `⠿` handle | drag to reorder |
| `✎` | back to the input: text and attachments return to the composer; if the composer is not empty the person is asked to replace or cancel |
| `🗑` | remove; attachments dropped |
| `⋯` | Move up · Move down · Edit · Remove |
| `Alt+↑` / `Alt+↓` on a focused row | move; new position announced |

- Row text is one line, truncated; the full text is the row's title.
- There is no "send now".
- A `blocked` row shows its reason in place of the text's second half ("File no longer allowed — edit or remove") and is skipped.
- Each row is a list item in a labelled list ("Queued messages"); controls have text labels for assistive technology.

## Draining

- When `canTake` becomes true the first sendable row leaves the panel and appears in the conversation as an ordinary outgoing message; the next waits for that turn to close.
- **Held** — the panel shows one line and two actions instead of draining:
  - agent failed or stopped: "The agent did not start. Your messages are kept." · *Clear queue*
  - older than a day: "These were written a while ago." · *Send now* · *Clear queue* (*Send now* here means "resume draining", and exists only in this state)
- Two tabs: the list is the same in both; a row is sent by one.

## Twin differences that stay

| | `admin` | `app` |
|---|---|---|
| queue state | on the conversation record | a `queues` map keyed by `conv.key`, beside `drafts` |
| "answering" | `hasOpenTurn(c)` | a new getter `isAnswering(key)` extracted from `newChatBlock` |
| agent not ready | `agentState` prop + `tools` | `agentOnline` + `tools` |
| storage user | signed-in user id | user id, or the share visitor id |

## Tests (bun, both consoles)

- `utils/queue.spec.ts` — cap, order, move, remove, `canTake` table, held reasons, blocked skipped, the day rule.
- `stores/bridle` — queued when not ready; drained one per turn; restored after reload; not sent twice with the lock taken elsewhere; cleared on account change.
- `agent/utils/toolState.spec.ts` — wording per audience; nothing with a server name for a non-manager.
- Typecheck in both; `locale:check` and `i18n:check` for `app`.
