// The pixel bar of a topic (CLEAN-270): how many pixels it gets beside the
// largest topic, and how many of them are resolved, left open, or neither.
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

/**
 * The pixels of the largest topic's bar. From the prototype
 * (specs/038-profile-stats-dashboard/reference/profile-stats-prototype.html,
 * `topicsBlock()`), tuned there by eye to the width of the topics column.
 */
export const TOPIC_PIXELS = 34;

export interface ITopicCounts {
  /** Summarised conversations that carry the topic. */
  conversations: number;
  resolved: number;
  open: number;
}

export interface ITopicPixels {
  resolved: number;
  open: number;
  /** Conversations whose summary could not tell: neither of the two. */
  unknown: number;
}

const NONE: ITopicPixels = { resolved: 0, open: 0, unknown: 0 };

const count = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * A topic's bar: `TOPIC_PIXELS` for the largest topic, the others in
 * proportion to it, and never less than one pixel for a topic that exists.
 *
 * The pixels are shared between resolved, open and the rest by largest
 * remainder, so they always add up to the bar; an equal claim goes to the
 * earlier part (resolved, then open), which is what the prototype's rounding
 * of the resolved part does for two parts.
 *
 * Parts that add up to more than the topic's conversations are drawn by
 * their own sum: an answer that contradicts itself still gets an honest
 * proportion and no negative rest.
 */
export function topicPixels(topic: ITopicCounts, largest: number): ITopicPixels {
  const conversations = count(topic.conversations);
  const most = count(largest);
  if (conversations === 0 || most === 0) return { ...NONE };

  const pixels = Math.min(
    TOPIC_PIXELS,
    Math.max(1, Math.round((TOPIC_PIXELS * conversations) / most)),
  );

  const resolved = count(topic.resolved);
  const open = count(topic.open);
  const parts = [resolved, open, Math.max(0, conversations - resolved - open)];
  const total = parts[0]! + parts[1]! + parts[2]!;

  const given = [0, 0, 0];
  const remainders = [0, 0, 0];
  let left = pixels;
  for (let index = 0; index < 3; index++) {
    const exact = (pixels * parts[index]!) / total;
    const whole = Math.floor(exact);
    given[index] = whole;
    remainders[index] = exact - whole;
    left -= whole;
  }
  // What the flooring left over goes to the largest remainders, the earlier
  // part first among equals.
  for (; left > 0; left--) {
    let best = 0;
    for (let index = 1; index < 3; index++) {
      if (remainders[index]! > remainders[best]!) best = index;
    }
    given[best] = given[best]! + 1;
    remainders[best] = -1;
  }

  return { resolved: given[0]!, open: given[1]!, unknown: given[2]! };
}
