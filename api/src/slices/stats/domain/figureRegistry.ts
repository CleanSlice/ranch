import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { captureBackgroundError } from '#/setup/sentry';
import { IFigureDefinition, IFigureNote } from './figure.types';
import { IStatFigureGateway } from './statFigure.gateway';

/**
 * The figures a statistics view can show, and since when each is complete
 * (CLEAN-261; spec 038, contracts/collection.md section 5).
 *
 * A figure is added by registering its definition, and there are two kinds.
 *
 * A recorded figure (its definition names a `rebuild`) is kept in a table
 * written for it, and that table starts at some moment. The first boot that
 * sees the figure writes its `StatFigure` row; from then on a view whose
 * period starts before that date carries a note for it, so a block says
 * "counted since …" instead of showing a part as if it were the whole
 * (FR-028).
 *
 * A figure read in place (no `rebuild`) has no row and no note, ever
 * (CLEAN-262). Its rows are the source. "No rows before that day" means
 * nothing happened before that day, not that something was missed. From the
 * data alone "the feature did not record yet" and "nobody did it yet" cannot
 * be told apart, and a note would claim the first, which is untrue: after the
 * first rating the page would say "counted since" that day, as if earlier
 * ratings had been lost.
 */
@Injectable()
export class FigureRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(FigureRegistry.name);
  private readonly figures = new Map<string, IFigureDefinition>();

  constructor(private readonly gateway: IStatFigureGateway) {}

  /**
   * Add a figure. Call it while the modules are being set up (a constructor
   * or `onModuleInit`): the rows are written in `onApplicationBootstrap`,
   * which Nest runs after every module's `onModuleInit`, so a figure
   * registered later than that gets its row only at the next boot.
   *
   * Two figures with one key would share a row and each other's history, so
   * the second is refused, and the API does not start with the mistake in.
   */
  register(definition: IFigureDefinition): void {
    if (this.figures.has(definition.key)) {
      throw new Error(
        `A figure with the key "${definition.key}" is already registered`,
      );
    }
    this.figures.set(definition.key, definition);
  }

  /** Every registered figure, in the order they were registered. */
  list(): IFigureDefinition[] {
    return [...this.figures.values()];
  }

  /**
   * Leave every registered figure with the row its kind has.
   *
   * A recorded figure that has no row gets one:
   * `completeSince = firstRecord() ?? now`. Once it has a row it is not
   * asked again and the date is never moved, whatever its table holds
   * today: what happened before the recording started stays missing.
   *
   * A figure read in place has no row. If one is there, it is removed,
   * whatever date it holds: the release before CLEAN-262 wrote such rows,
   * and each would go on saying "counted since" about a figure that is
   * missing nothing. Its `firstRecord` is not asked, since there is no date
   * to write.
   *
   * Nothing here stops the API from starting. A figure whose first record
   * cannot be read, or whose row cannot be written or removed, is logged
   * and reported, the others are still processed, and it is tried again at
   * the next boot. A recorded figure is then left without a row: writing
   * "now" for it instead would be a date that could never be moved back
   * once its table is readable. A row that could not be removed does no
   * harm meanwhile, because `notesFor` does not read it.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.figures.size === 0) return;

    let known: Set<string>;
    try {
      known = new Set((await this.gateway.findAll()).map((row) => row.key));
    } catch (err) {
      this.logger.error(
        `Could not read the statistics figures at boot: ${(err as Error).message}`,
      );
      captureBackgroundError(err, 'stats.figures');
      return;
    }

    for (const figure of this.figures.values()) {
      const hasRow = known.has(figure.key);
      if (isRecorded(figure)) {
        if (!hasRow) await this.writeOnce(figure);
      } else if (hasRow) {
        await this.removeRow(figure);
      }
    }
  }

  /** A recorded figure seen for the first time: write its row. */
  private async writeOnce(figure: IFigureDefinition): Promise<void> {
    try {
      const first = (await figure.firstRecord?.()) ?? null;
      await this.gateway.createIfAbsent(figure.key, first ?? new Date());
    } catch (err) {
      this.logger.error(
        `Could not write since when the figure "${figure.key}" is complete: ${(err as Error).message}`,
      );
      captureBackgroundError(err, 'stats.figures');
    }
  }

  /** A figure read in place that has a row: it should have none. */
  private async removeRow(figure: IFigureDefinition): Promise<void> {
    try {
      await this.gateway.remove(figure.key);
    } catch (err) {
      this.logger.error(
        `Could not remove the row of the figure "${figure.key}", which is read in place and has none: ${(err as Error).message}`,
      );
      captureBackgroundError(err, 'stats.figures');
    }
  }

  /**
   * The notes a period view starting at `from` carries for these figures:
   * one for each recorded figure whose `completeSince` is later than `from`,
   * in the order the keys were given. A figure complete from exactly `from`
   * has none.
   *
   * A figure read in place never has one, and asking about it is harmless.
   * A row found for it is not read: it is one that boot has not removed
   * yet, and its date says nothing true about the figure.
   *
   * The rows are read on every call rather than kept from boot. They are a
   * dozen at most, and a copy in memory would have to be kept right for the
   * figure whose row could not be written at boot.
   *
   * A key that was never registered is a mistake in the caller, and it
   * throws: answering "no note" would let a misspelt key show a partial
   * number as complete for good. A recorded figure that has no row yet has
   * no note.
   */
  async notesFor(keys: readonly string[], from: Date): Promise<IFigureNote[]> {
    const asked: IFigureDefinition[] = [];
    for (const key of new Set(keys)) {
      const figure = this.figures.get(key);
      if (!figure) {
        throw new Error(`No figure is registered with the key "${key}"`);
      }
      asked.push(figure);
    }
    const recorded = asked.filter(isRecorded);
    if (recorded.length === 0) return [];

    const completeSince = new Map(
      (await this.gateway.findAll()).map((row) => [row.key, row.completeSince]),
    );
    const notes: IFigureNote[] = [];
    for (const { key } of recorded) {
      const since = completeSince.get(key);
      if (since && since.getTime() > from.getTime()) {
        notes.push({ figure: key, completeSince: since });
      }
    }
    return notes;
  }
}

/**
 * Whether the figure is recorded in a table written for it. Naming a
 * `rebuild` is what says so (`IFigureDefinition.rebuild`); a figure without
 * one is read in place.
 */
function isRecorded(figure: IFigureDefinition): boolean {
  return figure.rebuild !== undefined;
}
