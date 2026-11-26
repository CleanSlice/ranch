// A figure is one number, or one family of numbers, a statistics view shows:
// messages, refusals, spend (CLEAN-261; spec 038, contracts/collection.md
// section 5). The stats slice holds no facts of its own. A definition names
// the figure and says how far back its source goes; the fact stays in the
// slice that owns it.

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
   * The earliest instant the figure's source covers, or null when it has
   * nothing yet. Asked once, the first time the figure is seen at boot, to
   * write `completeSince`. A figure whose recording starts with this release
   * answers null, and is complete from that boot on.
   */
  firstRecord(): Promise<Date | null>;
  /**
   * Name of the owning slice's rebuild, e.g. `chat.settle`, for a figure
   * that is recorded in a table written for it. Absent for a figure read in
   * place: its rows are the source, so there is nothing to rebuild.
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
