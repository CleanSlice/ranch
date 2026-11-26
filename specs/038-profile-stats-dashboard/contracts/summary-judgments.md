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
| **The judgment** | "Is this conversation about one of the subjects in this list? Which one?" Asked with the installation's vocabulary: up to 60 topics, most used first, by `key` and English label. |
| **Possible answers** | Up to two existing topics, each marked `clear` or `loose`. Or one proposed new topic: an English slug, and a label of 1 to 3 words in each console language. Or none: the conversation is small talk or too mixed to name. |
| **When none fit** | The conversation has no topic. It is counted in the coverage line and appears in no topic row. |
| **The threshold** | Only `clear` assignments are stored. A `loose` one is treated as none. A proposed topic is created only when the same call assigned no existing topic as `clear`. |
| **Below the threshold** | No topic, never a guess. Nothing is handed to a person: a missing topic costs a row in a list, and an operator can fold two topics into one afterwards (`mergedIntoId`). |
| **The calibration** | Task `T-CAL` in [../quickstart.md](../quickstart.md), section 6. A person labels 100 summarised conversations from our own installation with a subject each. The script runs the prompt over them in the batch's order and reports: the share of same-subject pairs that received the same topic (SC-008, target 90%); the share of `clear` assignments the labeller agrees with, and the same for `loose`; topics coined per 100 conversations. `loose` is promoted to stored only if its agreement is within 5 points of `clear`. If same-subject agreement is under the target, the prompt is revised and the task rerun before Story 3 ships; the final numbers and any change of target are written into this file with the reason. |

**Why the list is capped at 60**: it is what fits beside a 12 000-character
transcript without displacing it, and the top eight are what the page shows.
A topic outside the 60 can still be proposed again and is matched by its
`key`, which is unique, so it is reused rather than duplicated.

## Judgment 2: how it ended

| | |
|---|---|
| **The judgment** | "By the end of this conversation, did the person get what they asked for?" |
| **Possible answers** | `resolved`: the person confirmed it, or the last answer addresses the question and nothing follows. `open`: the person's last message is an unanswered question, a correction or a complaint, or the agent said it could not do it. `unknown`: anything else, including a conversation that only just started or changed subject at the end. |
| **When none fit** | `unknown`. Stored as such; shown as its own neutral part of the outcome bar; never listed under open questions (spec, edge case "A summary that could not tell"). |
| **The threshold** | An answer that is missing, misspelt or not one of the three is `unknown`. Today it is stored as `false`, that is, open. |
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
