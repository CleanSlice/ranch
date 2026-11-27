// A figure is one number, or one family of numbers, a statistics view shows:
// messages, refusals, spend (CLEAN-261; spec 038, contracts/collection.md
// section 5). The stats slice holds no facts of its own. A definition names
// the figure and says which kind it is: recorded in a table written for it,
// which starts at some moment, or read in place from rows that are the fact
// itself. The fact stays in the slice that owns it.

/** Which view a figure appears in. */
export type FigureScope = 'personal' | 'installation';

export interface IFigureDefinition {
  /**
   * Stable name: the key of the figure's `StatFigure` row and of its note in
   * a response. Renaming it starts the figure's history over.
   */
  key: string;
  scopes: readonly FigureScope[];
  /**
   * For a recorded figure only: the earliest instant its table covers, or
   * null when it holds nothing yet. The registry asks once, the first time
   * it sees the figure at boot, and writes the answer as `completeSince`. A
   * figure whose recording starts with this release answers null, or leaves
   * this out, and is complete from that boot on: what happened before it
   * was never recorded.
   *
   * A figure read in place does not carry it, and the registry would not
   * ask. Its rows are its source, so its earliest row is not the start of
   * its recording: nothing happened before it (CLEAN-262).
   */
  firstRecord?(): Promise<Date | null>;
  /**
   * Name of the owning slice's rebuild, e.g. `chat.settle`, for a figure
   * that is recorded in a table written for it. Absent for a figure read in
   * place: its rows are the source, so there is nothing to rebuild.
   *
   * It is also what tells the registry which kind the figure is. With a
   * rebuild the figure has a `StatFigure` row, written once and never
   * moved, and a period that starts before it carries a note. Without one
   * the figure has no row and never carries a note.
   */
  rebuild?: string;
}

/**
 * Carried by a period view for a figure that is not complete over the whole
 * period: it has been counted since `completeSince`, which is later than the
 * period's start. The page turns it into "counted since …" (FR-028).
 */
export interface IFigureNote {
  figure: string;
  completeSince: Date;
}

/** A `StatFigure` row. */
export interface IStatFigureData {
  key: string;
  completeSince: Date;
  updatedAt: Date;
}
