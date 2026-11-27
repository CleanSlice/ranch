import { describe, expect, test } from 'bun:test';
import {
  BAR_MIN,
  COLUMN_MAX,
  COLUMN_MIN,
  LABEL_ROOM,
  dailyColumns,
  dayBars,
  dayPricing,
} from './dailyColumns';

/** The chart's left margin, where the axis values stand. */
const PAD = 34;

describe('dailyColumns', () => {
  test('no days, no columns', () => {
    expect(dailyColumns(0, 640, PAD)).toEqual({ slot: 0, column: 0, labels: [] });
  });

  test('seven days on a wide chart: wide columns, capped, every day named', () => {
    const cols = dailyColumns(7, 640, PAD);
    expect(Math.round(cols.slot * 100) / 100).toBe(86.57);
    expect(cols.column).toBe(COLUMN_MAX);
    expect(cols.labels).toEqual([
      { index: 0, anchor: 'middle' },
      { index: 1, anchor: 'middle' },
      { index: 2, anchor: 'middle' },
      { index: 3, anchor: 'middle' },
      { index: 4, anchor: 'middle' },
      { index: 5, anchor: 'middle' },
      { index: 6, anchor: 'middle' },
    ]);
  });

  test('thirty days on a wide chart: a gap between columns, a date every few days', () => {
    const cols = dailyColumns(30, 640, PAD);
    expect(cols.slot).toBe(20.2);
    expect(Math.round(cols.column * 10) / 10).toBe(18.2);
    // Seven dates, the first and the last day among them.
    expect(cols.labels.length).toBe(7);
    expect(cols.labels[0]).toEqual({ index: 0, anchor: 'start' });
    expect(cols.labels[6]).toEqual({ index: 29, anchor: 'end' });
  });

  test('ninety days on a phone: columns stay two pixels wide and apart', () => {
    // 390 px wide screen: the card leaves the chart about 318 px.
    const cols = dailyColumns(90, 318, PAD);
    expect(cols.column).toBe(COLUMN_MIN);
    expect(cols.slot > cols.column).toBe(true);
    // The first and the last day are always named, the last from its right
    // edge and the first from its left: a centred date would leave the chart.
    expect(cols.labels[0]).toEqual({ index: 0, anchor: 'start' });
    expect(cols.labels[cols.labels.length - 1]).toEqual({ index: 89, anchor: 'end' });
    expect(cols.labels.length <= 5).toBe(true);
  });

  test('dates never stand closer than a date is wide', () => {
    for (const count of [7, 30, 90]) {
      for (const width of [250, 318, 400, 520, 640, 724]) {
        const cols = dailyColumns(count, width, PAD);
        const centre = (label: { index: number; anchor: string }) => {
          const left = PAD + label.index * cols.slot;
          if (label.anchor === 'start') return left + LABEL_ROOM / 2;
          if (label.anchor === 'end') return left + cols.slot - LABEL_ROOM / 2;
          return left + cols.slot / 2;
        };
        for (let i = 1; i < cols.labels.length; i++) {
          const gap = centre(cols.labels[i]!) - centre(cols.labels[i - 1]!);
          expect(gap >= LABEL_ROOM - 0.001).toBe(true);
        }
        // Nothing is drawn past the chart's right edge.
        const last = cols.labels[cols.labels.length - 1]!;
        expect(last.index).toBe(count - 1);
        expect(centre(last) + LABEL_ROOM / 2 <= width + 0.001).toBe(true);
      }
    }
  });

  test('a column is never wider than its slot', () => {
    // Narrower than any card gets: the columns thin out instead of merging.
    const cols = dailyColumns(90, 180, PAD);
    expect(cols.column < cols.slot).toBe(true);
    expect(cols.column > 0).toBe(true);
  });

  test('one day is one column with its date', () => {
    const cols = dailyColumns(1, 640, PAD);
    expect(cols.column).toBe(COLUMN_MAX);
    expect(cols.labels).toEqual([{ index: 0, anchor: 'middle' }]);
  });
});

describe('dayPricing', () => {
  const part = (priced: boolean, tokens = 1000) => ({ priced, tokens });

  test('every model has a price: the cost is the whole cost', () => {
    expect(dayPricing([part(true)])).toBe('priced');
    expect(dayPricing([part(true), part(true)])).toBe('priced');
  });

  test('no model has a price: the cost is unknown', () => {
    expect(dayPricing([part(false)])).toBe('unpriced');
    expect(dayPricing([part(false), part(false)])).toBe('unpriced');
  });

  test('some have one and some have none: the cost is of a part', () => {
    expect(dayPricing([part(true), part(false)])).toBe('partial');
    expect(dayPricing([part(false), part(true), part(true)])).toBe('partial');
  });

  test('a day nobody reported usage for has nothing unknown in it', () => {
    expect(dayPricing([])).toBe('priced');
  });

  test('a model that spent nothing in the day says nothing about the day', () => {
    expect(dayPricing([part(true), part(false, 0)])).toBe('priced');
    expect(dayPricing([part(false), part(true, 0)])).toBe('unpriced');
    expect(dayPricing([part(false, 0)])).toBe('priced');
  });
});

describe('dayBars', () => {
  // The chart's plot: 162 px high, its zero at y = 170.
  const PLOT = 162;
  const BASE = 170;
  const part = (model: string, tokens: number, color = model) => ({ model, color, tokens });

  test('a day without usage has no bars', () => {
    expect(dayBars([], 1000, PLOT, BASE)).toEqual([]);
    expect(dayBars([part('a', 0)], 1000, PLOT, BASE)).toEqual([]);
  });

  test('parts are stacked from the axis up, each as high as its tokens', () => {
    const bars = dayBars([part('a', 500), part('b', 250)], 1000, PLOT, BASE);
    expect(bars).toEqual([
      { key: 'a', color: 'a', y: 89, height: 81 },
      { key: 'b', color: 'b', y: 48.5, height: 40.5 },
    ]);
  });

  test('neighbours of one colour are one bar', () => {
    const bars = dayBars(
      [part('a', 500), part('b', 100, 'rest'), part('c', 100, 'rest')],
      1000,
      PLOT,
      BASE,
    );
    expect(bars.length).toBe(2);
    expect(bars[1]!.key).toBe('b');
    expect(Math.round(bars[1]!.height * 100) / 100).toBe(32.4);
    expect(Math.round(bars[1]!.y * 100) / 100).toBe(56.6);
  });

  test('a few tokens against a huge maximum are still a bar one can see', () => {
    // 12 tokens of 5 million: 0.0004 px by the scale.
    const bars = dayBars([part('a', 12)], 5_000_000, PLOT, BASE);
    expect(bars).toEqual([{ key: 'a', color: 'a', y: BASE - BAR_MIN, height: BAR_MIN }]);
    expect(BAR_MIN).toBe(1.5);
  });

  test('only the topmost bar is raised, and it stays on the one under it', () => {
    const bars = dayBars([part('a', 500_000), part('b', 12)], 1_000_000, PLOT, BASE);
    expect(bars[0]).toEqual({ key: 'a', color: 'a', y: 89, height: 81 });
    expect(bars[1]!.height).toBe(BAR_MIN);
    // Its foot is on the top of the bar under it; the rise goes upwards.
    expect(Math.round((bars[1]!.y + bars[1]!.height) * 1000) / 1000).toBe(bars[0]!.y);
    expect(bars[1]!.y).toBe(87.5);
  });

  test('a bar that is high enough is left as the scale drew it', () => {
    const bars = dayBars([part('a', 10)], 1000, PLOT, BASE);
    expect(Math.round(bars[0]!.height * 100) / 100).toBe(1.62);
  });

  test('no scale, no bars', () => {
    expect(dayBars([part('a', 10)], 0, PLOT, BASE)).toEqual([]);
    expect(dayBars([part('a', 10)], 1000, 0, BASE)).toEqual([]);
  });
});
