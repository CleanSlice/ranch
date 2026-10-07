import { rankByUsage, usageByIdSource } from './sourceUsage';

describe('usageByIdSource', () => {
  it('folds citation counts and rating groups into one record per source, zeros filled', () => {
    const usage = usageByIdSource(
      new Map([
        ['s1', 4],
        ['s2', 1],
      ]),
      [
        { sourceId: 's1', rating: 1, count: 3 },
        { sourceId: 's1', rating: -1, count: 1 },
        { sourceId: 's3', rating: -1, count: 2 },
      ],
    );
    expect(usage.get('s1')).toEqual({ cited: 4, likes: 3, dislikes: 1 });
    expect(usage.get('s2')).toEqual({ cited: 1, likes: 0, dislikes: 0 });
    // Rated under an answer whose citation row is gone: still counted.
    expect(usage.get('s3')).toEqual({ cited: 0, likes: 0, dislikes: 2 });
    expect(usage.get('nobody')).toBeUndefined();
  });
});

describe('rankByUsage', () => {
  const usage = new Map([
    ['a', { cited: 2, likes: 0, dislikes: 5 }],
    ['b', { cited: 9, likes: 1, dislikes: 0 }],
    ['c', { cited: 2, likes: 7, dislikes: 0 }],
  ]);

  it('orders by the chosen number, most first for desc', () => {
    expect(rankByUsage(['a', 'b', 'c', 'd'], usage, 'cited', 'desc')).toEqual(['b', 'a', 'c', 'd']);
    expect(rankByUsage(['a', 'b', 'c', 'd'], usage, 'dislikes', 'desc')).toEqual(['a', 'b', 'c', 'd']);
    expect(rankByUsage(['a', 'b', 'c', 'd'], usage, 'likes', 'asc')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('keeps creation order among equals so pages stay stable', () => {
    expect(rankByUsage(['c', 'a', 'd'], usage, 'cited', 'desc')).toEqual(['c', 'a', 'd']);
  });
});
