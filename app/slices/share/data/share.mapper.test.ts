import { describe, expect, test } from 'bun:test';
import { ShareMapper } from './share.mapper';

const FULL = {
  agentId: 'a',
  agentName: 'Support bot',
  agentStatus: 'running',
  description: 'Answers questions about orders.',
  skills: [{ title: 'Orders', description: 'Tracks orders' }],
  limits: { perMinute: null, perHour: 20, perDay: 100 },
  attachments: {
    maxPerMessage: 5,
    maxFileBytes: 10485760,
    maxMessageBytes: 26214400,
    kinds: ['image', 'pdf', 'text'],
  },
};

const resolve = (raw: unknown) => new ShareMapper().toResolved(raw);

describe('ShareMapper.toResolved', () => {
  test('reads a full answer', () => {
    expect(resolve(FULL)).toEqual(FULL);
  });

  // The page re-resolves against whatever API is deployed. One that does not
  // know the summary yet must still open the chat.
  test('an answer from an older API is still a resolved link', () => {
    expect(
      resolve({ agentId: 'a', agentName: 'N', agentStatus: 'running' }),
    ).toEqual({
      agentId: 'a',
      agentName: 'N',
      agentStatus: 'running',
      description: null,
      skills: [],
      limits: null,
      attachments: null,
    });
  });

  test('malformed extras degrade one by one', () => {
    const r = resolve({
      agentId: 'a',
      description: 7,
      skills: [{ title: 'Ok' }, { title: 3 }, null, 'x', { title: '  ' }],
      limits: { perMinute: '5', perHour: 20, perDay: -1 },
      attachments: { maxPerMessage: 5 },
    });
    expect(r?.description).toBe(null);
    expect(r?.skills).toEqual([{ title: 'Ok', description: null }]);
    expect(r?.limits).toEqual({ perMinute: null, perHour: 20, perDay: null });
    expect(r?.attachments).toBe(null);
  });

  test('a blank description is no description', () => {
    expect(resolve({ agentId: 'a', description: '   ' })?.description).toBe(
      null,
    );
  });

  test('limits with no usable window are no limits', () => {
    expect(resolve({ agentId: 'a', limits: { perHour: 0 } })?.limits).toBe(
      null,
    );
    expect(resolve({ agentId: 'a', limits: { perDay: 1.5 } })?.limits).toBe(
      null,
    );
    expect(resolve({ agentId: 'a', limits: 'none' })?.limits).toBe(null);
  });

  test('unknown attachment kinds are dropped, known ones kept in order', () => {
    const r = resolve({
      ...FULL,
      attachments: { ...FULL.attachments, kinds: ['image', 'exe', 7, 'pdf'] },
    });
    expect(r?.attachments?.kinds).toEqual(['image', 'pdf']);
  });

  test('no agent id is still no link', () => {
    expect(resolve({ agentName: 'N' })).toBe(null);
    expect(resolve(null)).toBe(null);
  });
});
