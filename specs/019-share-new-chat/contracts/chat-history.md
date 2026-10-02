# Contract: the conversation a person sees

Customer console (`app`): the agent chat page, the share page and the landing
hero — every host of `<BridleChatProvider>`. The API is not changed.

## The route (existing, unchanged)

`GET /api/agent/{agentId}/transcript?channel={clientId}&limit=50[&cursor=…]`
(`operationId: getBridleTranscript`)

| Part | Value |
|------|-------|
| `channel` | the conversation's client id from `welcome.clientId` |
| Console caller | bearer |
| Share visitor | `X-Share-Token` + `X-Share-Visitor`, no bearer |
| Answer | `{ messages, channel, nextCursor, hasMore, proposals }` — messages oldest first, `user` and `assistant` only |

A dead share link answers `403`, which the share page already turns into its
invalid-link state.

## When the console asks

| Moment | What is loaded |
|--------|----------------|
| The first `welcome` of a conversation in this page session | the newest page |
| A `welcome` after a load that failed | the newest page, again |
| The scroll reaches the top and `hasMore` | the next older page |
| After a reset (HTTP success or `conversation_reset`) | nothing now; the next `welcome`-triggered load starts over |

Not on every reconnect: a socket that drops and returns is filled by the hub's
replay, as today.

Not for an anonymous conversation (client id `anon-…`, the landing page's demo
chat for someone not signed in): the hub gives it a new channel on every
connection, so there is no history to load, and its stored copy behaves as it
does today.

## What is on screen after a load

In order:

1. The page's messages, as the server returned them — the person's and the
   agent's (FR-020), with attachments (FR-023) and proposal cards in place.
2. Below them, in the order they happened, what the server does not hold yet:

| On screen before the load | After |
|---------------------------|-------|
| The person's message, not delivered | kept, same delivery state |
| An answer still streaming; an open thinking block | kept |
| An agent message newer than the page's newest | kept |
| The person's delivered message the page does not contain, sent within 2 min of the page's newest or later | kept |
| Any message the page contains | shown once, as the page has it |
| A message from the browser's stored copy that the page does not contain and that is older than 10 min | dropped — it belonged to a conversation that was closed (FR-025) |
| A delivered message older than the page reaches | dropped from this view; it is on an older page |

"The page contains it" is decided by id and, until the runtime stores the wire
id, by identical text within ±2 minutes — the admin console's rule.

**Guarantees**

- Once: no message appears twice after any number of loads (FR-022, SC-010).
- Nothing in flight is lost: undelivered messages and the exchange in progress
  survive a load.
- A failed load changes nothing on screen and shows no error; the stored copy
  stands in until a load succeeds (FR-024).
- The first paint is the stored copy; the load replaces it without moving the
  scroll position when the person is at the bottom, and without scrolling them
  there when they are not.

## Paging

- A page is prepended; what the person is reading stays where it is.
- While a page is loading: the line `chat.older_loading` at the top.
- While more exists and none is loading: the line `chat.older_hint`.
- One page at a time.

## Copy (English source)

`app/slices/bridle/i18n/locales/en.json`, under `chat`:

| Key | English |
|-----|---------|
| `older_loading` | Loading earlier messages… |
| `older_hint` | Scroll up for earlier messages |

## What loaded history does not carry

Thinking steps, delivery states of messages that were delivered, and anything
else the transcript does not store. The admin console's loaded history lacks
the same things.

## Specs owed

`app/slices/bridle/utils/transcriptMerge.test.ts` — the rule as cases:

- empty local + page → the page;
- local equals the page (ids differ, text and time match) → the page, once;
- undelivered message not in the page → kept below, state intact;
- streaming bubble → kept;
- agent message newer than the tail → kept; at or before the tail → dropped;
- delivered message older than the page reaches → dropped;
- the same text sent twice, two minutes apart or more → both shown;
- stored-copy messages, page empty, 11 minutes old → dropped;
- stored-copy messages, page empty, 1 minute old → kept;
- no page (load failed) → local unchanged;
- proposal card on screen and in the page → one card, the page's status.

The admin store's `loadTranscript` is the reference these cases are read
against; where a case would differ between the consoles, the difference is the
stored-copy clause and nothing else.
