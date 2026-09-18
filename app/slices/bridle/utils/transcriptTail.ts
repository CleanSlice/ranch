// The safety net behind the live channel (CLEAN-102, research D5): when a turn
// goes silent, the agent's own transcript is asked what it answered. Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

import {
  BridleDeliveryStates,
  BridleRoleTypes,
  type IBridleMessage,
} from '../domain/bridle.types';

/** Whitespace-blind, so a trimmed or re-wrapped copy still compares equal. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * The agent messages in a transcript tail (oldest first, as the API returns
 * it) that the screen is missing: whatever the transcript holds after the
 * person's last question and the screen does not show yet.
 *
 * Nothing here compares timestamps or ids, deliberately. The screen mixes the
 * browser's clock with the agent's, and the runtime stores ids of its own,
 * unrelated to the wire `messageId` (research E2) — so the question is found
 * by its text and "newer" means "after it in the file". And until the runtime
 * persists one event per message (tasks T043) a whole turn is ONE transcript
 * event with its messages glued together: an event that starts with an answer
 * already on screen for this turn is that turn again, not news.
 */
export function missedReplies(
  onScreen: readonly IBridleMessage[],
  tail: readonly IBridleMessage[],
): IBridleMessage[] {
  // A question that never left this browser is in no transcript.
  let asked = -1;
  onScreen.forEach((m, i) => {
    if (
      m.role === BridleRoleTypes.User &&
      m.delivery !== BridleDeliveryStates.Failed
    ) {
      asked = i;
    }
  });
  const question = onScreen[asked];
  if (!question) return [];

  const wanted = squash(question.text);
  let anchor = -1;
  tail.forEach((m, i) => {
    if (m.role === BridleRoleTypes.User && squash(m.text) === wanted) anchor = i;
  });
  // Not in the tail: the agent never wrote the question down, or it is older
  // than this page — either way nothing after it can be trusted to be news.
  if (anchor === -1) return [];

  const ids = new Set(onScreen.map((m) => m.id));
  // Only what arrived for THIS question counts as shown: an agent that says
  // "Done." twice in one conversation said it twice.
  const answers = onScreen
    .slice(asked + 1)
    .filter((m) => m.role === BridleRoleTypes.Agent && squash(m.text));
  const shown = new Set(answers.map((m) => squash(m.text)));
  const turnPrefix = answers[0] ? squash(answers[0].text) : null;

  return tail.slice(anchor + 1).filter((m) => {
    if (m.role !== BridleRoleTypes.Agent) return false;
    const text = squash(m.text);
    if (!text || ids.has(m.id) || shown.has(text)) return false;
    return !(turnPrefix && text.startsWith(turnPrefix));
  });
}
