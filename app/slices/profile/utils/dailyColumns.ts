// The columns of the spend chart: how wide a day is, how wide its column, and
// which days have their date printed under them; the bars one day's column is
// stacked of, and whether the day's cost is the cost of all of them
// (CLEAN-265). Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.
//
// The chart is drawn at the width it has on screen, one unit to a pixel, so
// that a date is 10 px high on a phone as on a desktop. Everything here is in
// those pixels.

/** From the prototype's `daily()`: a column is 2 to 24 px wide, 2 px from the next. */
export const COLUMN_MIN = 2;
export const COLUMN_MAX = 24;
const COLUMN_GAP = 2;

/**
 * The room one date takes, with air around it: "26 нояб." is eight
 * characters of 6 px in the axis type, and 16 px keep two dates apart.
 */
export const LABEL_ROOM = 64;

export interface IDayLabel {
  /** The day's place in the period, oldest first. */
  index: number;
  /**
   * Where the date hangs from its day: centred under the column, or, for the
   * first and the last day of a chart whose days are narrower than a date,
   * from the day's left and right edge, so that it stays inside the chart.
   */
  anchor: 'start' | 'middle' | 'end';
}

export interface IDailyColumns {
  /** The width one day takes, column and gap together. */
  slot: number;
  /** The width of the column drawn in it. */
  column: number;
  /** The days whose date is printed, oldest first. */
  labels: IDayLabel[];
}

/**
 * `count` days in a chart `width` wide whose first `pad` pixels hold the axis
 * values.
 *
 * The first and the last day are always dated. Between them come as many
 * dates as fit with `LABEL_ROOM` each, spread evenly: 90 days on a phone get
 * four dates, 30 days on a desktop seven, and seven days there all seven.
 */
export function dailyColumns(count: number, width: number, pad: number): IDailyColumns {
  const plot = Math.max(0, width - pad);
  if (!(count > 0) || plot <= 0) return { slot: 0, column: 0, labels: [] };

  const slot = plot / count;
  let column = Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, slot - COLUMN_GAP));
  // Narrower than any card gets, but a column must not swallow its slot.
  if (column >= slot) column = slot * 0.6;

  const last = count - 1;
  // A day at least as wide as a date: every day has room for its own.
  if (slot >= LABEL_ROOM) {
    const labels: IDayLabel[] = [];
    for (let index = 0; index <= last; index++) labels.push({ index, anchor: 'middle' });
    return { slot, column, labels };
  }

  const end: IDayLabel = { index: last, anchor: 'end' };
  // Where the middle of a date stands: half its room in from the chart's
  // edges for the two at the ends, the middle of its day for the rest.
  const firstCentre = pad + LABEL_ROOM / 2;
  const lastCentre = width - LABEL_ROOM / 2;
  const span = lastCentre - firstCentre;
  if (last === 0 || span < LABEL_ROOM) return { slot, column, labels: [end] };

  const labels: IDayLabel[] = [{ index: 0, anchor: 'start' }];
  // A date moves up to half a day when it is put on its nearest day, so two
  // neighbours can close in by a whole day: that much is kept in hand.
  const parts = Math.floor(span / (LABEL_ROOM + slot));
  for (let part = 1; part < parts; part++) {
    const centre = firstCentre + (span * part) / parts;
    const index = Math.round((centre - pad - slot / 2) / slot);
    if (index > 0 && index < last) labels.push({ index, anchor: 'middle' });
  }
  labels.push(end);
  return { slot, column, labels };
}

/**
 * Whose cost a day's cost is. The API prices a day by the models the price
 * list has and leaves the others out of the sum:
 *
 * - `priced`: every model of the day has a price, the cost is the day's;
 * - `partial`: some have none, the cost is of the rest and is marked so;
 * - `unpriced`: none has one, the cost is unknown, never zero.
 */
export type DayPricing = 'priced' | 'partial' | 'unpriced';

/**
 * A model that spent nothing in the day says nothing about the day, and a
 * day nobody reported usage for is `priced`: nothing in it is unknown.
 */
export function dayPricing(
  parts: readonly { priced: boolean; tokens: number }[],
): DayPricing {
  let used = 0;
  let without = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part || !(part.tokens > 0)) continue;
    used++;
    if (!part.priced) without++;
  }
  if (without === 0) return 'priced';
  return without === used ? 'unpriced' : 'partial';
}

/**
 * The least height of the topmost bar of a day with usage. A few tokens
 * against a maximum of millions come to a fraction of a pixel, and a day
 * that looks empty reads as a day without usage. A pixel and a half is the
 * least that still shows as a mark of the model's colour on a plain screen.
 */
export const BAR_MIN = 1.5;

export interface IDayPart {
  /** As received. */
  model: string;
  color: string;
  tokens: number;
}

export interface IDayBar {
  /** The model the bar starts with: its key in the drawing. */
  key: string;
  color: string;
  /** The bar's upper edge. */
  y: number;
  height: number;
}

/**
 * The bars of one day, lowest first: `parts` in the order they are stacked,
 * `top` the value at the top of the axis, `plot` the height that value has
 * in pixels and `base` where the axis's zero is.
 *
 * Neighbours of one colour (the neutral rest) are one bar. Only the topmost
 * bar is raised to `BAR_MIN`, and it grows upwards: its foot stays on the bar
 * under it, so nothing below moves.
 */
export function dayBars(
  parts: readonly IDayPart[],
  top: number,
  plot: number,
  base: number,
): IDayBar[] {
  const bars: IDayBar[] = [];
  if (!(top > 0) || !(plot > 0)) return bars;

  let y = base;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part || !(part.tokens > 0)) continue;
    const height = (plot * part.tokens) / top;
    y -= height;
    const under = bars[bars.length - 1];
    if (under && under.color === part.color) {
      under.y = y;
      under.height += height;
    } else {
      bars.push({ key: part.model, color: part.color, y, height });
    }
  }

  const cap = bars[bars.length - 1];
  if (cap && cap.height < BAR_MIN) {
    cap.y -= BAR_MIN - cap.height;
    cap.height = BAR_MIN;
  }
  return bars;
}
