import { describe, expect, test } from 'bun:test';
import { TOPIC_PIXELS, topicPixels } from './topicPixels';

describe('topicPixels', () => {
  test('the largest topic fills the bar, the others are scaled to it', () => {
    const largest = topicPixels({ conversations: 20, resolved: 20, open: 0 }, 20);
    expect(largest.resolved + largest.open + largest.unknown).toBe(TOPIC_PIXELS);
    const half = topicPixels({ conversations: 10, resolved: 10, open: 0 }, 20);
    expect(half.resolved + half.open + half.unknown).toBe(17);
  });

  test('resolved and open take the bar in proportion, as the prototype draws them', () => {
    // 34 pixels, three quarters resolved: round(25.5) is 26.
    expect(topicPixels({ conversations: 8, resolved: 6, open: 2 }, 8)).toEqual({
      resolved: 26,
      open: 8,
      unknown: 0,
    });
    expect(topicPixels({ conversations: 4, resolved: 0, open: 4 }, 4)).toEqual({
      resolved: 0,
      open: 34,
      unknown: 0,
    });
  });

  test('a topic never has less than one pixel', () => {
    const tiny = topicPixels({ conversations: 1, resolved: 0, open: 1 }, 400);
    expect(tiny).toEqual({ resolved: 0, open: 1, unknown: 0 });
  });

  test('one pixel for an even split goes to resolved, the first of equals', () => {
    expect(topicPixels({ conversations: 2, resolved: 1, open: 1 }, 400)).toEqual({
      resolved: 1,
      open: 0,
      unknown: 0,
    });
  });

  test('conversations that ended neither way are a part of their own', () => {
    // 5 resolved, 3 open, 2 the summary could not tell: 17, 10.2, 6.8 of 34.
    expect(topicPixels({ conversations: 10, resolved: 5, open: 3 }, 10)).toEqual({
      resolved: 17,
      open: 10,
      unknown: 7,
    });
  });

  test('the parts always add up to the pixels of the topic', () => {
    for (let conversations = 1; conversations <= 40; conversations++) {
      for (let resolved = 0; resolved <= conversations; resolved++) {
        for (let open = 0; open + resolved <= conversations; open += 3) {
          const pixels = topicPixels({ conversations, resolved, open }, 40);
          const expected = Math.max(1, Math.round((TOPIC_PIXELS * conversations) / 40));
          expect(pixels.resolved + pixels.open + pixels.unknown).toBe(expected);
        }
      }
    }
  });

  test('parts that add up to more than the topic are drawn by their own sum', () => {
    const pixels = topicPixels({ conversations: 4, resolved: 3, open: 3 }, 4);
    expect(pixels).toEqual({ resolved: 17, open: 17, unknown: 0 });
  });

  test('nothing to draw is no pixels', () => {
    const none = { resolved: 0, open: 0, unknown: 0 };
    expect(topicPixels({ conversations: 0, resolved: 0, open: 0 }, 10)).toEqual(none);
    expect(topicPixels({ conversations: 5, resolved: 1, open: 1 }, 0)).toEqual(none);
    expect(topicPixels({ conversations: Number.NaN, resolved: 1, open: 1 }, 10)).toEqual(none);
  });

  test('a topic larger than the largest named does not overflow the bar', () => {
    const pixels = topicPixels({ conversations: 30, resolved: 30, open: 0 }, 10);
    expect(pixels.resolved).toBe(TOPIC_PIXELS);
  });
});
