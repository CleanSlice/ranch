# Conversation summaries in production

The API can summarise conversations by itself: every N seconds
`ChatInsightService` takes the conversations that have gone quiet and asks the
model for a short recap, the person's main question, the outcome (resolved,
open, unknown), tone and language. The profile's statistics show what comes of
it: the share resolved, how conversations end, the open questions, and per
agent the conversations left open. The summary button on a conversation's page
in the admin console does the same for that one conversation and works whether
the batch runs or not.

## When the batch runs

Three things have to hold, and `summaries.enabled` on `GET /me/stats` and
`GET /stats/installation` is their conjunction:

1. `CHAT_INSIGHT_INTERVAL_SEC` is a positive number in the API's environment,
   so the timer starts with the process;
2. a credential with the provider `anthropic` or `claude` is active in
   Settings → LLM credentials (the first by provider, then by model, is used);
3. the provider did not reject that credential the last time it was used.

When any of them fails, the statistics page shows one card saying summaries
are not produced, instead of the blocks that need them. It is the designed
state, not an error.

## Switching it on or off

Actions → **Ops - chat summaries (prod)** → Run workflow.

| Action | What it does |
|--------|--------------|
| `status` | looks only: the variable on the deployment, the running version, and what the batch has logged since the pod started |
| `enable` | sets `CHAT_INSIGHT_INTERVAL_SEC` to the interval given (900 by default, as in the manifests) and waits for the rollout |
| `disable` | removes the variable and waits for the rollout |

Why a workflow: the manifests have carried the variable since July, but the
cluster runs the `k8s/deploy` manifests as they were applied by hand and a
release only restarts the deployments, so a value in a manifest reaches the
pod only when somebody applies it. After v0.3.119 production answered
`summaries.enabled: false` with two active credentials for that reason
(CLEAN-279).

`enable` and `disable` roll the API out again, the same restart a release
does. The hub, the chat sockets and the MCP sessions live in that one process:
open chats reconnect. Run it when a release would be acceptable.

## Telling whether it works

- The workflow's report shows the line `chat insight batch enabled: every Ns`
  once the timer has started, and after the first interval a line per run:
  `insight batch: eligible=… summarized=… skipped=… failed=…`. `skipped` is a
  conversation with nothing to read; `failed` is an answer that could not be
  used or a provider error, and such a conversation is set aside for an hour,
  doubling to a day, instead of being asked again on every run.
- On the page, "How conversations end" says how many conversations have a
  summary and how many still wait for one. The waiting number falls by up to
  25 per run.
- If `enabled` stays false with the variable set, the credential is the
  cause: none is active for Anthropic, or the provider answers 401 or 403.

## What it costs

One model call per summarised conversation, at most 25 per run, on the model
of the credential it uses; a conversation is asked again only when something
new was said in it. A conversation of the Owner's assistant is summarised like
any other and gets no topic.

## What it does not do yet

Topics. The batch coins no topic and asks no topics question while the
installation has no vocabulary; how a vocabulary comes to exist is CLEAN-278.
The measured quality of the two judgments is in
`specs/038-profile-stats-dashboard/contracts/summary-judgments.md`.
