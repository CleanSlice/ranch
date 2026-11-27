import { IStatFigureData } from './figure.types';

export abstract class IStatFigureGateway {
  /** Every figure that has a row today. A dozen rows at most. */
  abstract findAll(): Promise<IStatFigureData[]>;
  /**
   * Write the figure's row unless it has one. An existing row is left as it
   * is. For a recorded figure, whose `completeSince` is written once and
   * never moved (data-model.md, `StatFigure`). No error either way.
   */
  abstract createIfAbsent(key: string, completeSince: Date): Promise<void>;
  /**
   * Delete the figure's row. For a figure read in place, which has none: a
   * row an earlier release wrote for it is removed at boot (CLEAN-262). No
   * error when there is no row.
   */
  abstract remove(key: string): Promise<void>;
}
