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

Four things have to hold, and `summaries.enabled` on `GET /me/stats` and
`GET /stats/installation` is their conjunction:

1. `CHAT_INSIGHT_INTERVAL_SEC` is a positive number in the API's environment,
   so the timer starts with the process;
2. a credential with the provider `anthropic` or `claude` is active in
   Settings → LLM credentials. One whose key is an ordinary API key is taken
   before one whose key is a subscription token (`sk-ant-oat…`, the kind the
   agents run on); within each kind the first by provider, then by model, is
   used. The summary button uses the same one;
3. the provider did not reject that credential the last time it was used
   (401 or 403);
4. the provider did not refuse two runs of the batch in a row (CLEAN-280). A
   run is refused when it called the model at least once and every call came
   back with an error status, any 4xx or 5xx. A conversation with nothing to
   read, a transcript that could not be read, an answer that could not be
   used and a run with nothing to summarise do not count: those are about a
   conversation, not about the provider. One call that is answered in a run
   and the run is not refused.

The fourth works in two steps, so that a provider that is down for a minute
does not change what people see:

- After **one** refused run the batch doubts the provider and says nothing.
  `enabled` stays true, and the next run is a probe: it asks about one
  conversation instead of 25.
- When the **next run that calls the model** is refused too, `enabled` turns
  false, and the API logs it once. The probes go on, one conversation a run.
- The first call the provider answers ends either step, and the run after it
  is a whole one. A run with nothing to summarise, and a call that got no
  answer at all, leave things as they were.

So a blip costs one probe and never reaches the page; a provider that
refuses the batch as such reaches the page one interval after it began,
having cost 25 calls and one where every run used to cost 25.

That is how a subscription token shows. The provider refuses a direct
summary request made with one: production, whose two Anthropic credentials
were both such tokens, got `429 rate_limit_error` for all 50 calls of two
runs. A token is still used when it is the only kind there is, because an
installation may have one that is served; when it is not, the batch says so
instead of promising summaries.

Conditions 3 and 4 are kept in the API's memory, per credential as it was
last saved. Each ends when a call goes through, the summary button's
included, or when the credential is saved again; a restart forgets both and
the next run finds out again. The summary button never starts either step
of the fourth: it is one conversation a person asked about, and they read
the error.

When any of the four fails, the statistics page shows one card saying
summaries are not produced, instead of the blocks that need them. It is the
designed state, not an error.

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
- When a run reports failures, the same report sorts them by kind and counts
  them: the provider's HTTP status with its error type and the words its
  message mentions (from a fixed list: workspace, credit balance, rate limit,
  model and a few more), an answer that could not be used with the reason,
  a transcript that could not be read, or another error. No conversation id
  and no provider message is printed: the repository and its Actions logs are
  public, and a provider's message can carry an organisation's identifiers.
  The full lines are in the API log, as `insight failed for <chat id>: …`.
- On the page, "How conversations end" says how many conversations have a
  summary and how many still wait for one. The waiting number falls by up to
  25 per run.
- If `enabled` stays false with the variable set, the credential is the
  cause: none is active for Anthropic, the provider answers 401 or 403, or
  it refuses run after run (next point).
- A refused batch looks like this in the report: one run line with nothing
  summarised and `failed` equal to `eligible`
  (`eligible=25 summarized=0 skipped=0 failed=25`), then run lines of one
  conversation (`eligible=1 summarized=0 skipped=0 failed=1`), and under the
  failures by kind nothing but the provider's HTTP status, `429` with
  `rate_limit_error` for a subscription token. After the second of those
  lines the report also shows the line the API logs once, at warn, when
  `enabled` turns false:
  `insight batch refused: the provider refused every call of the run
  (HTTP 429); the credential is a subscription token: true; summaries are
  reported as not produced until a call succeeds`. The status is the one the
  probe got, and `true` or `false` is the kind of the credential: nothing of
  a key is logged. The report shows the last such line of the pod's log, so
  read it beside the run lines: a run that summarised something after it
  means the state is over. A single run line of that shape with no such
  line after it is the first step, a doubt and not yet a refusal.
- While either step lasts a run asks about one conversation instead of 25,
  so a provider that recovers is noticed within an interval and one that
  does not is asked four times an hour, not a hundred.
- What to do about it: add an ordinary Anthropic API key in Settings → LLM
  credentials, with the provider `anthropic` or `claude`, and leave the
  agents' subscription tokens as they are. The batch takes the key from its
  next run on, which is a whole one, and `enabled` answers true at once. If
  the credential in use already is an API key, the status says what the
  provider objects to (a rate limit, a credit balance, a model it does not
  know, an outage), and the first call that is answered ends the state by
  itself: the run that follows is a whole one again.

## What it costs

One model call per summarised conversation, at most 25 per run, on the model
of the credential it uses; a conversation is asked again only when something
new was said in it. A conversation of the Owner's assistant is summarised like
any other and gets no topic.

Give the batch a key of its own: an API key that no agent runs on. Its calls
are then billed and rate-limited apart from the agents', and a limit the
summaries run into is not one an agent answering a person runs into. From
the first run the provider refuses whole until a call is answered, the batch
makes one call per run.

## What it does not do yet

Topics. The batch coins no topic and asks no topics question while the
installation has no vocabulary; how a vocabulary comes to exist is CLEAN-278.
The measured quality of the two judgments is in
`specs/038-profile-stats-dashboard/contracts/summary-judgments.md`.
