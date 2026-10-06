import { describe, expect, test } from 'bun:test';
import { appendView, createWatchers, emptyView, refreshView, upsertById } from './eventList';

describe('refreshView', () => {
  test('the first load takes the page and its cursor', () => {
    expect(refreshView(emptyView(), ['c', 'b'], 'cur-b')).toEqual({
      ids: ['c', 'b'],
      nextCursor: 'cur-b',
      loaded: true,
    });
  });

  test('a refresh puts new rows on top and never duplicates an id', () => {
    const first = refreshView(emptyView(), ['c', 'b', 'a'], null);
    const again = refreshView(first, ['d', 'c', 'b'], null);
    expect(again.ids).toEqual(['d', 'c', 'b', 'a']);
    expect(refreshView(again, ['d', 'c', 'b'], null).ids).toEqual(['d', 'c', 'b', 'a']);
  });

  test('a refresh keeps the rows and the cursor Load more brought in', () => {
    let view = refreshView(emptyView(), ['d', 'c'], 'cur-c');
    view = appendView(view, ['b', 'a'], 'cur-a');
    view = refreshView(view, ['e', 'd'], 'cur-d');
    expect(view.ids).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(view.nextCursor).toBe('cur-a');
  });

  test('a burst bigger than a page restarts the list instead of leaving a hole', () => {
    // On screen: c b a. More than a page arrived since — the newest page is
    // z y x and shares nothing with the list; w…d sit unseen between them.
    let view = refreshView(emptyView(), ['c', 'b', 'a'], 'cur-a');
    view = refreshView(view, ['z', 'y', 'x'], 'cur-x');

    // The list is the newest page, whole, and Load more continues below it.
    expect(view).toEqual({ ids: ['z', 'y', 'x'], nextCursor: 'cur-x', loaded: true });
    view = appendView(view, ['w', 'v', 'u'], 'cur-u');
    expect(view.ids).toEqual(['z', 'y', 'x', 'w', 'v', 'u']);
  });

  test('a page that shares nothing but has nothing behind it is simply merged', () => {
    // No cursor: the page is everything there is, so nothing can be missing.
    const view = refreshView(refreshView(emptyView(), ['b', 'a'], null), ['d', 'c'], null);
    expect(view.ids).toEqual(['d', 'c', 'b', 'a']);
  });

  test('an empty page changes nothing', () => {
    const first = refreshView(emptyView(), ['b', 'a'], 'cur-a');
    expect(refreshView(first, [], null)).toEqual(first);
  });
});

describe('appendView', () => {
  test('appends the older page in order and moves the cursor', () => {
    const view = appendView(refreshView(emptyView(), ['d', 'c'], 'cur-c'), ['b', 'a'], null);
    expect(view.ids).toEqual(['d', 'c', 'b', 'a']);
    expect(view.nextCursor).toBe(null);
  });

  test('skips an id that is already on screen', () => {
    const view = appendView(refreshView(emptyView(), ['d', 'c'], 'cur-c'), ['c', 'b'], null);
    expect(view.ids).toEqual(['d', 'c', 'b']);
  });
});

describe('upsertById', () => {
  test('replaces the record with the same id and adds the new one', () => {
    const before = { a: { id: 'a', n: 1 } };
    const after = upsertById(before, [
      { id: 'a', n: 2 },
      { id: 'b', n: 3 },
    ]);
    expect(after).toEqual({ a: { id: 'a', n: 2 }, b: { id: 'b', n: 3 } });
    expect(before).toEqual({ a: { id: 'a', n: 1 } });
  });
});

describe('createWatchers', () => {
  function harness(visible = () => true) {
    const timers: Array<() => void> = [];
    let cleared = 0;
    const ticks: string[][] = [];
    const watchers = createWatchers({
      intervalMs: 5000,
      tick: (keys) => ticks.push(keys),
      isVisible: visible,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {
        cleared += 1;
      },
    });
    return { watchers, timers, ticks, cleared: () => cleared };
  }

  test('two watchers share one timer and the last unwatch stops it', () => {
    const h = harness();
    h.watchers.watch('');
    h.watchers.watch('');
    expect(h.timers.length).toBe(1);
    h.watchers.unwatch('');
    expect(h.watchers.running()).toBe(true);
    expect(h.cleared()).toBe(0);
    h.watchers.unwatch('');
    expect(h.watchers.running()).toBe(false);
    expect(h.cleared()).toBe(1);
  });

  test('one timer serves every key, and a beat names the keys watched', () => {
    const h = harness();
    h.watchers.watch('');
    h.watchers.watch('agent-1');
    expect(h.timers.length).toBe(1);
    h.timers[0]!();
    expect(h.ticks).toEqual([['', 'agent-1']]);
    h.watchers.unwatch('agent-1');
    h.timers[0]!();
    expect(h.ticks[1]).toEqual(['']);
  });

  test('a hidden tab skips the beat', () => {
    let visible = false;
    const h = harness(() => visible);
    h.watchers.watch('');
    h.timers[0]!();
    expect(h.ticks.length).toBe(0);
    visible = true;
    h.timers[0]!();
    expect(h.ticks.length).toBe(1);
  });
});
