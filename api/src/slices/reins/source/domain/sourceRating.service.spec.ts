import { SourceRatingService } from './sourceRating.service';
import { ISourceRatingGateway } from './sourceRating.gateway';
import type { ISourceRatingData, IRateSourceInput } from './source.types';

// In-memory rows keyed the way the table is unique.
function makeGateway() {
  const rows = new Map<string, ISourceRatingData>();
  const key = (s: string, m: string, a: string) => `${s}|${m}|${a}`;
  // Standalone so a test can assert on it without pulling a method off the
  // gateway object (the lint's unbound-method rule).
  const findByAuthor = jest.fn(async (messageIds: string[], authorId: string) =>
    [...rows.values()].filter(
      (r) => messageIds.includes(r.messageId) && r.authorId === authorId,
    ),
  );
  const gateway: ISourceRatingGateway = {
    upsert: jest.fn(async (i: IRateSourceInput) => {
      const k = key(i.sourceId, i.messageId, i.authorId);
      const existing = rows.get(k);
      const row: ISourceRatingData = existing
        ? { ...existing, rating: i.rating, updatedAt: new Date(1) }
        : {
            id: `r-${rows.size + 1}`,
            ...i,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          };
      rows.set(k, row);
      return row;
    }),
    delete: jest.fn(async (s: string, m: string, a: string) => {
      rows.delete(key(s, m, a));
    }),
    findByAuthor,
  };
  return { gateway, rows, findByAuthor };
}

describe('SourceRatingService — one verdict per reader, source and answer', () => {
  it('creates, flips in place, and withdraws', async () => {
    const { gateway, rows } = makeGateway();
    const service = new SourceRatingService(gateway);
    const first = await service.rate({
      sourceId: 's1',
      messageId: 'm1',
      authorId: 'u1',
      rating: 1,
    });
    const flipped = await service.rate({
      sourceId: 's1',
      messageId: 'm1',
      authorId: 'u1',
      rating: -1,
    });
    expect(flipped.id).toBe(first.id);
    expect(rows.size).toBe(1);
    await service.unrate('s1', 'm1', 'u1');
    await service.unrate('s1', 'm1', 'u1'); // idempotent
    expect(rows.size).toBe(0);
  });

  it('keeps the same source under two answers apart (FR-022 scenario 6)', async () => {
    const { gateway, rows } = makeGateway();
    const service = new SourceRatingService(gateway);
    await service.rate({
      sourceId: 's1',
      messageId: 'm1',
      authorId: 'u1',
      rating: 1,
    });
    await service.rate({
      sourceId: 's1',
      messageId: 'm2',
      authorId: 'u1',
      rating: -1,
    });
    expect(rows.size).toBe(2);
  });

  it('answers the viewer’s own verdicts keyed by message and source', async () => {
    const { gateway, findByAuthor } = makeGateway();
    const service = new SourceRatingService(gateway);
    await service.rate({
      sourceId: 's1',
      messageId: 'm1',
      authorId: 'u1',
      rating: 1,
    });
    await service.rate({
      sourceId: 's2',
      messageId: 'm1',
      authorId: 'u1',
      rating: -1,
    });
    await service.rate({
      sourceId: 's1',
      messageId: 'm1',
      authorId: 'u2',
      rating: -1,
    });
    expect(await service.mine(['m1'], 'u1')).toEqual({
      'm1:s1': 1,
      'm1:s2': -1,
    });
    expect(await service.mine(['m1'], 'nobody')).toEqual({});
    expect(await service.mine([], 'u1')).toEqual({});
    expect(findByAuthor).toHaveBeenCalledTimes(2);
  });
});
