import { describe, expect, test } from 'bun:test';

import type { IChatMessage } from '#chat/stores/chat';
import { formatMessageTime, groupTranscript } from './transcript';

// CLEAN-127: this stamp read "21 авг., 00:46" in a Russian browser, because the
// language was left to the browser. It is English whoever is looking.
describe('formatMessageTime', () => {
  const sent = new Date(2026, 7, 21, 0, 46, 12).getTime();

  test('a message from an earlier day carries the day', () => {
    expect(formatMessageTime(sent, new Date(2026, 8, 29, 12, 0, 0))).toBe('Aug 21, 00:46');
  });

  test('a message from today is the time alone', () => {
    expect(formatMessageTime(sent, new Date(2026, 7, 21, 23, 59, 0))).toBe('00:46');
  });

  test('a message from an earlier year carries the year', () => {
    expect(formatMessageTime(sent, new Date(2027, 0, 5, 12, 0, 0))).toBe(
      'Aug 21, 2026, 00:46',
    );
  });
});

// CLEAN-242: the live chat folds narration ("I'll check what's on hand.") into
// a thinking block; the history showed every line as a reply of its own.
describe('groupTranscript', () => {
  let n = 0;
  const msg = (role: IChatMessage['role'], text: string, extra: Partial<IChatMessage> = {}) =>
    ({ id: `m${++n}`, role, text, ts: n * 1000, ...extra }) as IChatMessage;

  test('narration before a reply becomes the thinking block above it', () => {
    const items = groupTranscript([
      msg('user', 'How many years?'),
      msg('assistant', "I'll check what's on hand.", { interim: true }),
      msg('assistant', 'Seven model years.'),
    ]);
    expect(items.map((i) => i.message?.text)).toEqual(['How many years?', 'Seven model years.']);
    expect(items[1]!.thinking?.steps.map((s) => s.label)).toEqual(["I'll check what's on hand."]);
    expect(items[1]!.thinking?.status).toBe('done');
    expect(items[0]!.thinking).toBe(null);
  });

  test('tools of the same stretch sit in the block in the order they ran', () => {
    const items = groupTranscript([
      msg('user', 'Packages?'),
      msg('assistant', 'Let me look.', { interim: true }),
      msg('tool_call', 'search({"q":"cx-5"})'),
      msg('tool_result', 'ok'),
      msg('assistant', 'Now the order form.', { interim: true }),
      msg('assistant', 'Here they are.'),
    ]);
    const reply = items[1]!;
    expect(reply.thinking?.steps.map((s) => s.label)).toEqual([
      'Let me look.',
      'search',
      'Now the order form.',
    ]);
    expect(reply.tools.map((t) => t.result)).toEqual(['ok']);
  });

  test('thinking off drops the narration and leaves the tools as rows', () => {
    const items = groupTranscript(
      [
        msg('assistant', 'Let me look.', { interim: true }),
        msg('tool_call', 'search({})'),
        msg('tool_result', 'ok'),
        msg('assistant', 'Done.'),
      ],
      { thinking: false },
    );
    expect(items.length).toBe(1);
    expect(items[0]!.thinking).toBe(null);
    expect(items[0]!.tools.map((t) => t.name)).toEqual(['search']);
  });

  test('narration with no reply after it still shows, as a block of its own', () => {
    const items = groupTranscript([
      msg('assistant', 'Checking…', { interim: true }),
      msg('user', 'Hello?'),
    ]);
    expect(items[0]!.message).toBe(null);
    expect(items[0]!.thinking?.steps.map((s) => s.label)).toEqual(['Checking…']);
    expect(items[1]!.message?.text).toBe('Hello?');
  });

  test('a turn with no narration keeps its tools as rows, no block', () => {
    const items = groupTranscript([msg('tool_call', 'search({})'), msg('assistant', 'Done.')]);
    expect(items[0]!.thinking).toBe(null);
    expect(items[0]!.tools.length).toBe(1);
  });
});
