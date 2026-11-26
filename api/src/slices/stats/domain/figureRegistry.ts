import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { captureBackgroundError } from '#/setup/sentry';
import { IFigureDefinition, IFigureNote } from './figure.types';
import { IStatFigureGateway } from './statFigure.gateway';

/**
 * The figures a statistics view can show, and since when each is complete
 * (CLEAN-261; spec 038, contracts/collection.md section 5).
 *
 * A figure is added by registering its definition. The first boot that sees
 * it writes its `StatFigure` row; from then on a view whose period starts
 * before that date carries a note for it, so a block says "counted since …"
 * instead of showing a part as if it were the whole (FR-028).
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
   * Write a row for every registered figure that has none:
   * `completeSince = firstRecord() ?? now`. A figure that has a row is not
   * asked again: the date is written once and never moved, whatever its
   * source holds today.
   *
   * Nothing here stops the API from starting. A figure whose first record
   * cannot be read is left without a row and tried again at the next boot.
   * Writing "now" for it instead would be a date that could never be moved
   * back once the source is readable.
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
      if (known.has(figure.key)) continue;
      try {
        const first = await figure.firstRecord();
        await this.gateway.createIfAbsent(figure.key, first ?? new Date());
      } catch (err) {
        this.logger.error(
          `Could not write since when the figure "${figure.key}" is complete: ${(err as Error).message}`,
        );
        captureBackgroundError(err, 'stats.figures');
      }
    }
  }

  /**
   * The notes a period view starting at `from` carries for these figures:
   * one for each whose `completeSince` is later than `from`, in the order the
   * keys were given. A figure complete from exactly `from` has none.
   *
   * The rows are read on every call rather than kept from boot. They are a
   * dozen at most, and a copy in memory would have to be kept right for the
   * figure whose row could not be written at boot.
   *
   * A key that was never registered is a mistake in the caller, and it
   * throws: answering "no note" would let a misspelt key show a partial
   * number as complete for good. A registered figure that has no row yet
   * has no note.
   */
  async notesFor(keys: readonly string[], from: Date): Promise<IFigureNote[]> {
    const asked = [...new Set(keys)];
    for (const key of asked) {
      if (!this.figures.has(key)) {
        throw new Error(`No figure is registered with the key "${key}"`);
      }
    }
    if (asked.length === 0) return [];

    const completeSince = new Map(
      (await this.gateway.findAll()).map((row) => [row.key, row.completeSince]),
    );
    const notes: IFigureNote[] = [];
    for (const key of asked) {
      const since = completeSince.get(key);
      if (since && since.getTime() > from.getTime()) {
        notes.push({ figure: key, completeSince: since });
      }
    }
    return notes;
  }
}
