import { IStatFigureData } from './figure.types';

export abstract class IStatFigureGateway {
  /** Every figure the product has seen so far. A dozen rows at most. */
  abstract findAll(): Promise<IStatFigureData[]>;
  /**
   * Write the figure's row unless it has one. An existing row is left as it
   * is: `completeSince` is written once and never moved (data-model.md,
   * `StatFigure`). No error either way.
   */
  abstract createIfAbsent(key: string, completeSince: Date): Promise<void>;
}
