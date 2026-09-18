// TWIN FILE: `app/slices/bridle/utils/chatFlow.test.ts` — change them together.
import { describe, expect, test } from 'bun:test'
import { buildChatFlow, nextSeq, numberLegacy } from './chatFlow'

// Local-time constructor on purpose: day separators follow the reader's
// calendar, so the fixtures must not depend on the machine's timezone.
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime()

const NOW = at(2026, 9, 18, 15)
const options = { locale: 'en', now: NOW }

const msg = (id: string, ts: number, seq?: number, role: 'user' | 'assistant' = 'user') => ({
  id,
  role,
  ts,
  ...(seq === undefined ? {} : { seq }),
})

const block = (turnId: string, seg: number, ts: number, seq: number) => ({
  turnId,
  seg,
  ts,
  seq,
  status: 'done' as const,
})

describe('buildChatFlow', () => {
  test('a reply stamped 2 minutes EARLIER than the question still renders after it', () => {
    // Browser clock runs 2 min ahead of the agent's (research F1).
    const question = msg('q', at(2026, 9, 18, 12, 2), 1)
    const reply = msg('a', at(2026, 9, 18, 12, 0), 2, 'assistant')
    const flow = buildChatFlow([reply, question], [], options)
    expect(flow.map(i => i.key)).toEqual(['m-q', 'm-a'])
  })

  test('equal ts is ordered by seq', () => {
    const ts = at(2026, 9, 18)
    const flow = buildChatFlow([msg('b', ts, 2), msg('a', ts, 1), msg('c', ts, 3)], [], options)
    expect(flow.map(i => i.key)).toEqual(['m-a', 'm-b', 'm-c'])
  })

  test('thinking segments interleave by seq, whatever their ts says', () => {
    const ts = at(2026, 9, 18)
    const flow = buildChatFlow(
      [msg('q', ts + 5000, 1), msg('a', ts, 3, 'assistant')],
      // Agent-clock ts far in the past — must still sit between q and a.
      [block('t1', 0, ts - 60_000, 2)],
      options,
    )
    expect(flow.map(i => i.key)).toEqual(['m-q', 'b-t1#0', 'm-a'])
    expect(flow.map(i => i.kind)).toEqual(['message', 'block', 'message'])
  })

  test('inserts a day separator where the calendar day changes, and above a first message that is not from today', () => {
    const flow = buildChatFlow(
      [
        msg('old', at(2026, 9, 10), 1),
        msg('y1', at(2026, 9, 17, 23, 50), 2),
        msg('t1', at(2026, 9, 18, 0, 5), 3),
        msg('t2', at(2026, 9, 18, 9), 4),
      ],
      [],
      options,
    )
    expect(flow.map(i => i.key)).toEqual(['d-old', 'm-old', 'd-y1', 'm-y1', 'd-t1', 'm-t1', 'm-t2'])
    const days = flow.filter(i => i.kind === 'day')
    expect(days.map(d => d.kind === 'day' && d.relative)).toEqual([null, 'yesterday', 'today'])
    // The separator takes the seq of the message it precedes.
    expect(days.map(d => d.seq)).toEqual([1, 2, 3])
  })

  test('a day that is neither today nor yesterday gets a long date label', () => {
    const flow = buildChatFlow(
      [msg('a', at(2026, 3, 1), 1), msg('b', at(2026, 3, 2), 2)],
      [],
      options,
    )
    const days = flow.filter(i => i.kind === 'day')
    expect(days.map(d => d.kind === 'day' && d.relative)).toEqual([null, null])
    expect(days.map(d => d.kind === 'day' && d.label)).toEqual(['March 1, 2026', 'March 2, 2026'])
  })

  test('a conversation that started today has no separator, and a thinking segment never opens one', () => {
    const flow = buildChatFlow(
      [msg('a', at(2026, 9, 18, 9), 1), msg('b', at(2026, 9, 18, 10), 3)],
      [block('t', 0, at(2026, 9, 17), 2)],
      options,
    )
    expect(flow.some(i => i.kind === 'day')).toBe(false)
  })

  test('messages without seq keep their array order; a block without one sinks to the end', () => {
    const ts = at(2026, 9, 18)
    const orphan = { turnId: 't', seg: 0, ts: ts - 60_000, status: 'done' as const }
    const flow = buildChatFlow([msg('x', ts + 2), msg('y', ts + 1), msg('z', ts)], [orphan], options)
    expect(flow.map(i => i.key)).toEqual(['m-x', 'm-y', 'm-z', 'b-t#0'])
  })

  test('hands back the message objects it was given, not copies', () => {
    const legacy = msg('x', at(2026, 9, 18))
    const flow = buildChatFlow([legacy], [], options)
    expect(flow[0]?.kind === 'message' && flow[0].message).toBe(legacy)
  })
})

describe('nextSeq', () => {
  test('starts at 1', () => {
    expect(nextSeq([])).toBe(1)
    expect(nextSeq([{}])).toBe(1)
  })

  test('is one above the highest seq, negatives included', () => {
    expect(nextSeq([{ seq: 4 }, { seq: 9 }, { seq: -3 }])).toBe(10)
  })
})

describe('numberLegacy', () => {
  test('numbers messages without seq in array order', () => {
    const out = numberLegacy([msg('a', 30), msg('b', 10), msg('c', 20)])
    expect(out.map(m => [m.id, m.seq])).toEqual([['a', 1], ['b', 2], ['c', 3]])
  })

  test('fills only the gaps: one past the highest seq seen so far', () => {
    const out = numberLegacy([msg('a', 1, 5), msg('b', 2), msg('c', 3)])
    expect(out.map(m => m.seq)).toEqual([5, 6, 7])
  })

  test('leaves a fully numbered list alone and does not mutate its input', () => {
    const input = [msg('a', 1, 7), msg('b', 2, 9)]
    const out = numberLegacy(input)
    expect(out.map(m => m.seq)).toEqual([7, 9])
    const legacy = [msg('x', 1)]
    numberLegacy(legacy)
    expect('seq' in legacy[0]!).toBe(false)
  })
})
