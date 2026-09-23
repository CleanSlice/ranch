import { describe, expect, test } from 'bun:test';
import { mergeProposals, proposalMessageId, proposalTs } from './proposalMerge';

type Msg = { id: string; ts: number };
const make = (p: { id: string; createdAt: string }): Msg => ({
  id: proposalMessageId(p.id),
  ts: proposalTs(p),
});

describe('mergeProposals', () => {
  test('places a proposal after the last message created before it', () => {
    const messages: Msg[] = [
      { id: 'u1', ts: 1000 },
      { id: 'a1', ts: 2000 },
      { id: 'u2', ts: 3000 },
    ];
    const out = mergeProposals(messages, [{ id: 'p1', createdAt: new Date(2500).toISOString() }], make);
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'proposal:p1', 'u2']);
  });

  test('keeps an already present bubble where it is (no duplicates on re-page)', () => {
    const messages: Msg[] = [
      { id: 'u1', ts: 1000 },
      { id: 'proposal:p1', ts: 1500 },
      { id: 'a1', ts: 2000 },
    ];
    const out = mergeProposals(messages, [{ id: 'p1', createdAt: new Date(1500).toISOString() }], make);
    expect(out.map((m) => m.id)).toEqual(['u1', 'proposal:p1', 'a1']);
  });

  test('appends proposals newer than everything, in creation order', () => {
    const messages: Msg[] = [{ id: 'u1', ts: 1000 }];
    const out = mergeProposals(
      messages,
      [
        { id: 'p2', createdAt: new Date(5000).toISOString() },
        { id: 'p1', createdAt: new Date(4000).toISOString() },
      ],
      make,
    );
    expect(out.map((m) => m.id)).toEqual(['u1', 'proposal:p1', 'proposal:p2']);
  });

  test('prepends a pending proposal older than the page (never lost to paging)', () => {
    const messages: Msg[] = [{ id: 'u9', ts: 9000 }];
    const out = mergeProposals(messages, [{ id: 'p0', createdAt: new Date(100).toISOString() }], make);
    expect(out.map((m) => m.id)).toEqual(['proposal:p0', 'u9']);
  });

  test('returns a copy when there is nothing to add', () => {
    const messages: Msg[] = [{ id: 'u1', ts: 1 }];
    const out = mergeProposals(messages, [], make);
    expect(out).toEqual(messages);
    expect(out).not.toBe(messages);
  });

  test('treats an unparsable createdAt as the beginning of time', () => {
    expect(proposalTs({ id: 'x', createdAt: 'nope' })).toBe(0);
  });
});
