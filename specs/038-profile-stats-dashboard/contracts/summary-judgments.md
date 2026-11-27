# Contract: Summary judgments

**Plan**: [../plan.md](../plan.md) | **Research**: [../research.md](../research.md) (R7)

Constitution Principle VII: where a decision needs semantic understanding,
the plan names the judgment, its possible answers, the threshold and what
happens below it, and the calibration that produces that threshold on our own
data. The conversation summary makes two such judgments that this feature
puts in front of people. Both are made in the one model call the summary
batch already makes, with the credential it already uses.

The same call also writes the summary text and the main question; those are
generation, shown only to the conversation's owner as the summary's words,
and carry no decision.

## Judgment 1: which topic

| | |
|---|---|
| **The judgment** | "Which area of work is the person's main request in? Is it one of the topics in this list?" Asked with the installation's vocabulary: up to 60 topics, most used first, by `key` and English label. A topic is a broad area of work or need that many conversations share over months: the heading a team would file conversations under, not the task of one conversation, so two conversations that ask for different things in the same area have the same topic. The main request decides, and the list is gone through before anything else. The prompt gives four examples of the level and says they are examples, not keys. |
| **Possible answers** | Up to two existing topics, each marked `clear` or `loose`; usually one, a second only when the conversation has two separate main requests. `clear`: the main request falls inside the area of that topic, even when the words differ or the conversation is about one corner of the area. `loose`: the conversation only touches it on the way. Or one proposed new topic, the last resort, only when no listed topic is the area of the main request: an English slug of one or two words that names the area as broadly as it stays meaningful, and a label of 1 to 3 words in each console language. Or none: the conversation is small talk or too mixed to name. |
| **When none fit** | The conversation has no topic. It is counted in the coverage line and appears in no topic row. |
| **The threshold** | Only `clear` assignments are stored. A `loose` one is treated as none. A proposed topic is created only when the same call assigned no existing topic as `clear`. A proposal whose key a topic already has is read as that topic (itself, or the one it was merged into) and does not get round the threshold: when that topic was in the list of this call, the proposal is none, because the model had it in front of it and did not call it `clear` (it called it `loose`, or did not name it); when it exists outside the list, it is reused, as below. A new key is coined only while fewer than 100 topics stand; at 100 the proposal is none. |
| **Below the threshold** | No topic, never a guess. Nothing is handed to a person: a missing topic costs a row in a list, and an operator can fold two topics into one afterwards (`mergedIntoId`). |
| **The calibration** | Task `T-CAL` in [../quickstart.md](../quickstart.md), section 6. A person labels 100 summarised conversations from our own installation with a subject each. The script runs the prompt over them in the batch's order and reports: the share of same-subject pairs that received the same topic (SC-008, target 90%); the share of `clear` assignments the labeller agrees with, and the same for `loose`; topics coined per 100 conversations. `loose` is promoted to stored only if its agreement is within 5 points of `clear`. A conversation the model failed on is in no share: the count of them is printed beside the headline number, and when more than 10% of the sample failed the script gives no verdict on the target, because the rest is then a sample picked by what the model could do. A pair neither side named a subject for is left out of the pairs. Each topic number is also reported for the second half of the sample alone, since the run starts with an empty vocabulary. If same-subject agreement is under the target, the prompt is revised and the task rerun before Story 3 ships; the final numbers and any change of target are written into this file with the reason. |

**Why the list is capped at 60**: it is what fits beside a 12 000-character
transcript without displacing it, and the top eight are what the page shows.
A topic outside the 60 can still be proposed again and is matched by its
`key`, which is unique, so it is reused rather than duplicated. The topics
the running batch coined, or picked up this way, are always among the 60 for
the rest of the run, in the place of the least used: by count alone a topic
coined a conversation ago is the sixty-first.

**Who is asked this judgment at all**: every conversation but those with an
agent only the Owner manages (today the Ranch assistant). The vocabulary is
the installation's, a topic is shown to every operator, and a topic coined
from a conversation nobody but the Owner may read would be a reading of it.
Such a conversation is asked judgment 2 and the main question only: its
prompt lists no topic and asks for none, and whatever its answer says about
topics is not read.

**What the list gives away**: it is printed beside what a person wrote, in
every conversation's prompt, so a person can have it repeated in the summary
of their own conversation. They then hold the names, 1 to 3 words each, of
the subjects people here talk about. Accepted as the price of one vocabulary
for the installation.

## Judgment 2: how it ended

| | |
|---|---|
| **The judgment** | "By the end of this conversation, did the person get what they asked for?" |
| **Possible answers** | `resolved`: the person got what they asked for: they confirmed it, or the last answer does what was asked and nothing further follows. `open`: the person had a real request and the conversation ends without it being met: their last message is an unanswered question, a correction or a complaint; or the agent said it could not do it; or the agent is waiting for something from the person that it needs to finish. `unknown`: anything else: it cannot be told; the conversation only just started or changed subject at the end; or the person was only trying the agent out or exploring, with no real request, whatever the agent answered. When torn between `resolved` and `open`, the answer is `unknown`: the open conversations are a list somebody acts on. |
| **When none fit** | `unknown`. Stored as such; shown as its own neutral part of the outcome bar; never listed under open questions (spec, edge case "A summary that could not tell"). |
| **The threshold** | An answer that is missing, misspelt or not one of the three is `unknown`. Today it is stored as `false`, that is, open. For that reason a summary written before version 2 is not migrated to `open`: its `true` becomes `resolved` and anything else `unknown`, until the conversation is summarised again by this prompt (data-model.md, *Migration*). |
| **Below the threshold** | The conversation is absent from "open questions" and from the resolved share's numerator, and present in its denominator's coverage line only. |
| **The calibration** | The same 100 conversations, each also labelled resolved, open or cannot tell. The script reports precision and recall of `open` and of `resolved`. `open` is what a person is shown as a list with a button, so its precision is the number that matters: target 80%. Under it, the definition of `open` in the prompt is narrowed and the task rerun. Numbers and reason are written here. |

## Existing debt, stated

The summary call has been in `main` since before Principle VII, with
`sentiment` and `language` judged in the same call and no calibration. This
feature shows tone as four counts to the person the tone belongs to and
language as a share; neither drives a decision or a list. They are left as
they are, cited here as debt and not copied: the two judgments this feature
relies on are the two calibrated above.

## Results

*To be filled by `T-CAL` before Story 3 is merged: date, sample size, the four
numbers for topics, the four for outcomes, the prompt version, and any target
that was changed with its reason.*

Three runs, all on 2026-11-28 and over the same sample. **Neither target is
met.** The targets are unchanged: 90% of same-subject pairs with the same
topic, 80% precision of `open`. What the runs say, and the decision they
leave open, is at the end of this section.

### First run, 2026-11-28

Prompt version 2 in its first wording, over 33 conversations, with the
production model, `claude-haiku-5-5`, and `max_tokens` 4096. The model
failed on none. **Both targets were missed.**

What the sample is, and what its numbers can and cannot say:

- **33 conversations, not 100.** They are of our own installation, which has
  no more that qualify. 31 are scored; two near-duplicates are left out.
  Read the counts, not only the shares.
- **The reference labels are not a person's.** A subject and an outcome per
  conversation were written by a stronger model reading each conversation
  blind, where this contract asks for a person. Such a reference catches a
  prompt that is plainly wrong. It cannot certify agreement with a person.
- **The transcripts are not whole.** Five are missing their first request,
  and two carry an automatic recovery message under the person's marker.

Topics (judgment 1):

| | |
|---|---|
| Same-subject pairs that got the same topic (target 90%) | 7 of 39, 17.9% |
| Pairs the model joined that the reference calls one subject | 7 of 25, 28% |
| Topics coined | 15 in 33 conversations, 45 per 100; 29 per 100 in the second half, when a vocabulary existed |

The reference's largest subject holds 8 conversations, which is 28 of the 39
pairs. The model split almost all of them into separate, narrower topics, and
it joined other conversations the reference kept apart.

Outcomes (judgment 2):

| | |
|---|---|
| `open`, precision (target 80%) | 6 of 9, 66.7% |
| `open`, recall | 6 of 7 |
| `resolved`, precision | 17 of 21 |
| `resolved`, recall | 17 of 17 |

The three conversations wrongly called `open` are ones the reference calls
`unknown`: in two the person was only trying the agent out and a test request
was declined, and one had two unrelated requests. The one `open` that was
missed was a request left waiting on the person, which the model called
`resolved`. Three more that the reference calls `unknown` were called
`resolved`.

What was wrong in what the prompt asked, whatever the sample: it did not say
at what level a topic is, and it let the model coin a narrow one whenever the
wording of the list differed from the conversation's; and its definition of
`open` counted a declined try-out as a person left without an answer.

What was changed, in the same change as this entry (the two tables above
state the judgments as revised):

- **Topics.** The prompt states the level: a broad area of work that many
  conversations share over months, not the task of one conversation. The
  main request decides. The list is gone through first, and a listed topic
  whose area holds the main request is a `clear` fit even when the words
  differ. A new topic is the last resort and is named broadly, with a key of
  one or two words. Usually one topic, a second only for two separate main
  requests.
- **Outcomes.** `open` is a real request the conversation ends without
  meeting, which now includes the agent waiting for something it needs from
  the person. A person only trying the agent out or exploring is `unknown`,
  whatever the agent answered. Torn between `resolved` and `open`, the answer
  is `unknown`.

The thresholds, the parser and the shape of the answer are as they were, and
the prompt version stays 2: the first wording was never released, and a
calibration stores nothing.

### Second run, 2026-11-28: the revised wording, an empty vocabulary

The same 33 conversations, the same model and `max_tokens`, the prompt as
revised above, and no topic before the first conversation. The model failed
on none. **Both targets were missed.**

One thing was changed in the revision before this run. Its first draft gave,
as the four examples of the level of a topic, four phrases that coincided
with subjects of the reference: a run with them would have measured a hint.
They were replaced with neutral ones (deliveries, returns, account access,
pricing plans), so the run measures the judgment.

Topics (judgment 1):

| | |
|---|---|
| Same-subject pairs that got the same topic (target 90%) | 14 of 39, 35.9% |
| Pairs the model joined that the reference calls one subject | 14 of 68, 20.6% |
| Pairs agreed on, same or different | 386 of 465, 83.0% |
| Topics coined | 10 in 33 conversations, 30.3 per 100; 3 in the 17 of the second half |

The topics are broader, as asked: two hold 10 and 7 conversations, two hold
4, one holds 2 and five hold 1; one conversation has none. Twice as many
same-subject pairs met as in the first run, and the model joined more pairs
the reference keeps apart: of the pairs it joined, 20.6% are one subject by
the reference, where 28.0% were. It cut the same conversations along another
axis: by kind of work, where the reference cut by what was being set up.

Outcomes (judgment 2):

| | |
|---|---|
| `open`, precision (target 80%) | 7 of 11, 63.6% |
| `open`, recall | 7 of 7 |
| `resolved`, precision | 13 of 13 |
| `resolved`, recall | 13 of 17 |

Every conversation the reference calls open was found, the request left
waiting on the person included. `resolved` no longer takes in a conversation
the reference does not call resolved (13 of 13, where it was 17 of 21), and
finds fewer of those it does (13 of 17, where it was 17 of 17). `open` is
still called too often: 4 of the 11 are not open by the reference.

### Third run, 2026-11-28: the vocabulary given

The same revised wording, sample, model and `max_tokens`, run with
`--vocabulary`: the reference's 12 subjects stood as 12 seeded topics before
the first conversation, each with a key and its labels in English and
Russian. The model failed on none.

This is judgment 1 as this contract states it: a choice from a list. The
first two runs had no list, and what they compare, pair by pair, is two ways
of cutting the sample into groups. So the number read against the 90% here
is the share of conversations stored with the topic of their reference
subject, over the 28 scored conversations the reference gave a subject.
**Under the target, by eight points.**

Topics (judgment 1):

| | |
|---|---|
| Chosen as the reference chose (target 90%) | 23 of 28, 82.1% |
| The same, in the second half of the sample | 11 of 13, 84.6% |
| The 5 not chosen so | another seeded topic 3, no topic 1, a topic coined in the run 1 |
| Topics coined although a list was given | 1 in 33 conversations, 3.0 per 100 |
| The 3 conversations with no subject by the reference | left without a topic 2, given a topic 1 |

The run is optimistic in one way: the list was made from the same
conversations it classifies. No installation's vocabulary is made so.

Outcomes (judgment 2), from the same calls:

| | |
|---|---|
| `open`, precision (target 80%) | 7 of 12, 58.3% |
| `open`, recall | 7 of 7 |
| `resolved`, precision | 15 of 15 |
| `resolved`, recall | 15 of 17 |

### What the runs say

**Neither target is met. The targets are not changed.**

| | First run | Second run | Third run |
|---|---|---|---|
| Wording of the prompt | first | revised | revised |
| Vocabulary at the start | empty | empty | the reference's 12 subjects |
| Judgment 1, against 90% | 7 of 39 pairs, 17.9% | 14 of 39 pairs, 35.9% | 23 of 28 chosen, 82.1% |
| Topics coined in 33 conversations | 15 | 10 | 1 |
| `open`, precision, against 80% | 6 of 9, 66.7% | 7 of 11, 63.6% | 7 of 12, 58.3% |
| `open`, recall | 6 of 7 | 7 of 7 | 7 of 7 |
| `resolved`, precision | 17 of 21 | 13 of 13 | 15 of 15 |
| `resolved`, recall | 17 of 17 | 13 of 17 | 15 of 17 |

What they were run on, the same in all three:

- **The sample.** Conversations of our own installation, exported through
  the read-only account on 2026-11-27 and 28 into a folder outside the repo.
  The installation's index held 204. Left out, by agreement with the owner:
  the Owner's assistant, the Mazda agents and the test agents (28); Telegram
  (7); conversations written by outside or anonymous identities, that is
  share links, widgets and HTTP callers (81); fewer than three messages from
  the person (52). Of the 36 that remained, 3 had a transcript that could not
  be read or was too short. That leaves 33, of which 31 are scored: two are
  prefixes of two others and are left out so that they do not inflate
  agreement. The installation has no more that qualify.
- **Eligible, not summarised.** This contract asks for summarised
  conversations. Production had exactly one, so that could not be the
  criterion; being eligible for a summary was.
- **The reference.** A subject of 1 to 3 words (the same words are the same
  subject) and an outcome per conversation, written by a stronger model that
  read every conversation to the end, blind to the summary prompt and to any
  answer of the model measured. Not by a person: the owner's decision of
  2026-11-28. It catches a prompt that is plainly wrong. It cannot certify
  agreement with a person, and an error both models make reads as agreement.
  It holds 12 subjects over the 33 (one of 8 conversations, one of 5, one of
  3, five of 2 and four of 1) and 3 conversations with no subject; of the 31
  scored, 17 are resolved, 7 open and 7 "cannot tell".
- **Defects of the data**, as the labeller reported them: five transcripts
  are missing the person's first request; two carry an automatic recovery
  message under the person's marker; eight conversations are longer than the
  12 000 characters the prompt keeps, so the model saw only their end.
- **How it was run.** `api/scripts/summary-calibration.ts` over the built
  API: the shipped prompt, parser and model call, with `claude-haiku-5-5`,
  the model production's batch picks (credentials are ordered by provider and
  `anthropic` comes first), and `max_tokens` 4096. No conversation failed in
  any run. The key used is not scoped to a workspace, so one header,
  `anthropic-workspace-id`, was added by a preload kept outside the repo; the
  request body was the shipped one.

Judgment 1, which topic:

- **From a given list: 82% on 28 conversations**, eight points under the
  target, against a reference that is itself a model's. Three of the five
  misses are conversations the labeller had marked as hard to call: the
  purpose unclear, or a defect of the data.
- **With no list, the model does not converge on the reference's subjects.**
  An empty vocabulary lets the first conversations decide the cut, and the
  two runs cut differently: 17.9% and 35.9% of same-subject pairs.
- **So topics are reliable to the extent a vocabulary exists.** How one comes
  to exist on a new installation is not settled by the prompt.

Judgment 2, how it ended:

- **`resolved` holds.** Precision 81%, 100% and 100% over the three runs;
  recall 100%, 76% and 88%.
- **`open` is over-called.** Precision 67%, 64% and 58%, on 9 to 12
  conversations; recall 86%, 100% and 100%.
- **The false ones recur**, and the reference calls them "cannot tell": a
  try-out with a declined test request, two unrelated requests in one
  conversation, a transcript missing its first request, an automatic recovery
  message read as the person's last word.
- **How far under is not shown.** With 7 open conversations in the
  reference, one conversation moves precision by about eight points. The
  runs show that `open` is not demonstrated at 80%, not how far under it is.

**Open, and not decided in this change:** whether the summary blocks ship
with these numbers stated, ship without the topics block until a vocabulary
can be seeded, or wait for a larger sample labelled by a person is the
owner's decision.
