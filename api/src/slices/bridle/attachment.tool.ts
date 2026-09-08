import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import type { Workbook } from 'exceljs';
import { z } from 'zod';
import { Tool } from '#mcp';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IBridleAttachmentGateway } from './domain/attachment.gateway';
import { MAX_QUERY_CELLS } from './domain/attachment.constants';
import { isSpreadsheetMimeType } from './domain/documentText.extractor';
import {
  WorkbookReadError,
  columnNumber,
  columnOf,
  describeWorkbook,
  formatRange,
  guessHeader,
  loadWorkbook,
  parseA1Range,
  readSheet,
  resolveSheet,
  type CellRef,
  type CellRow,
  type SheetInfo,
} from './domain/workbook.reader';
import {
  detectSheetStructure,
  type SheetStructure,
} from './domain/sheetStructure';

// Contract: specs/009-attachment-parse-quality/contracts/query-attachment-tool.md

const DESCRIPTION =
  'Query a spreadsheet attached to this conversation by its attachment id (shown in the "[Attached file: … — id: …]" line). Use it whenever an answer depends on the data in the file rather than on a glance at the preview: aggregating, comparing, filtering, counting or looking up values of any kind — quantities, prices, dates, grades, ratings, codes, text — whatever the sheet holds. Values returned here come from the file; never estimate or recompute them yourself when this tool can answer. The tool does not know what the cells mean: decide from the question and from the sheet\'s own labels which table, columns, rows and measure matter, then pick the operation and function that fit — not a default one. Always report the sheet, the range and the row labels you used next to the result. If what the person asks for is not in the file, say so — do not approximate. Start with op "describe" (sheets, headers, structure) when you are unsure which sheet, table or range to use. When you report a value taken from a sheet, name the label and the cell of the row it came from, and mention the other label → value lines around it that qualify or change it. If sheets are laid out differently, say so instead of forcing one layout on all of them. Use op "structure" to see a sheet\'s tables and the lines after them.';

/** Rows one `read` may return; beyond that the model is told to narrow. */
const READ_MAX_ROWS = 500;
const FIND_MAX_MATCHES = 100;
/** Counted cells listed individually on an aggregate; more is audit-only. */
const AGGREGATE_LIST_CELLS = 50;

const parameters = z.object({
  attachment_id: z
    .string()
    .uuid()
    .describe('Attachment id from the "[Attached file: … — id: …]" line.'),
  op: z
    .enum(['describe', 'read', 'aggregate', 'find', 'structure'])
    .describe(
      "describe: sheets, sizes, header guess and per-sheet structure. read: cells in a range (any kind of value). aggregate: sum, min, max, count or avg over numeric cells in a range — choose the function the question calls for. find: cells whose text contains a query. structure: one sheet's tables (range, header, data rows), title area and the label → value lines after each table, with cells.",
    ),
  sheet: z
    .union([z.string(), z.number().int().positive()])
    .optional()
    .describe(
      'Sheet name or 1-based index. Required for read, aggregate, find and structure.',
    ),
  range: z
    .string()
    .optional()
    .describe(
      'A1 range such as "F5:F47", a single cell "F12", or a column span "F:F". Required for aggregate; optional for read (defaults to the used area).',
    ),
  fn: z
    .enum(['sum', 'min', 'max', 'count', 'avg'])
    .optional()
    .describe('Aggregate function. Required for aggregate.'),
  where: z
    .object({
      column: z.string().describe('Column letter the condition applies to.'),
      op: z.enum(['eq', 'ne', 'contains', 'gt', 'lt']),
      value: z.union([z.string(), z.number()]),
    })
    .optional()
    .describe('Keep only rows whose cell in `column` satisfies the condition.'),
  query: z.string().optional().describe('Case-insensitive substring for find.'),
  include_hidden: z
    .boolean()
    .optional()
    .describe('Read hidden sheets too. Default false.'),
  include_computed: z
    .boolean()
    .optional()
    .describe(
      'Include formula cells in aggregate. Default true. Set false to skip cells computed from others (rows that summarise the ones above them, for example).',
    ),
});

type Args = z.infer<typeof parameters>;

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

const err = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * Deterministic computation over an attached workbook.
 *
 * The model reads a bounded preview of every spreadsheet; this is where it
 * gets exact numbers. Every result names the range it covered and what it
 * skipped, so the operator can verify the figure in the source file and
 * the model can quote the coordinates alongside it.
 */
@Injectable()
export class BridleAttachmentTool {
  private readonly logger = new Logger(BridleAttachmentTool.name);

  constructor(private readonly attachments: IBridleAttachmentGateway) {}

  @Tool({ name: 'query_attachment', description: DESCRIPTION, parameters })
  async query(
    args: Args,
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): Promise<ToolResult> {
    const agentId = this.extractAgentId(httpRequest);
    if (!agentId) {
      return err('query_attachment can only be called by an agent runtime.');
    }

    // Scoped to the caller's own prefix: another agent's id resolves to
    // nothing, and "not found" and "not yours" are deliberately the same.
    const stored = await this.attachments.fetch(agentId, args.attachment_id);
    if (!stored) {
      return err(
        `Attachment ${args.attachment_id} is not available to this agent.`,
      );
    }
    if (!isSpreadsheetMimeType(stored.mimeType)) {
      return err(
        `Attachment "${stored.name}" is a ${stored.mimeType}; query_attachment only reads xlsx/xlsm workbooks.`,
      );
    }

    let workbook: Workbook;
    try {
      workbook = await loadWorkbook(stored.body);
    } catch {
      return err(
        `Attachment "${stored.name}" could not be parsed as a workbook.`,
      );
    }

    const attachment = { id: stored.id, name: stored.name };
    try {
      switch (args.op) {
        case 'describe':
          return ok({ attachment, ...this.describe(workbook) });
        case 'read':
          return ok({ attachment, ...this.read(workbook, args) });
        case 'aggregate':
          return ok({ attachment, ...this.aggregate(workbook, args) });
        case 'find':
          return ok({ attachment, ...this.find(workbook, args) });
        case 'structure':
          return ok({ attachment, ...this.structure(workbook, args) });
      }
    } catch (e) {
      if (e instanceof WorkbookReadError) return err(e.message);
      const message = e instanceof Error ? e.message : 'query failed';
      this.logger.warn(
        `query_attachment ${args.op} failed for agent=${agentId} id=${args.attachment_id}: ${message}`,
      );
      return err(`Attachment "${stored.name}" could not be read: ${message}`);
    }
  }

  // ─── operations ─────────────────────────────────────────────────────

  private describe(workbook: Awaited<ReturnType<typeof loadWorkbook>>) {
    const { sheets } = describeWorkbook(workbook);
    return {
      sheets: sheets.map((info) => {
        if (info.state !== 'visible' || info.usedRows === 0) return info;
        const preview = readSheet(workbook, info.index, { maxRows: 30 });
        const headerGuess = guessHeader(preview.rows);
        // Structure needs every row (closing lines sit at the bottom); a
        // sheet over the cell cap simply has no structure here — the model
        // can still ask for it per sheet with a narrower op.
        let structure: SheetStructure | undefined;
        try {
          structure = detectSheetStructure(
            readSheet(workbook, info.index, { maxCells: MAX_QUERY_CELLS }).rows,
          );
        } catch (e) {
          if (!(e instanceof WorkbookReadError)) throw e;
        }
        return {
          ...info,
          ...(headerGuess ? { headerGuess } : {}),
          ...(structure ? { structure } : {}),
        };
      }),
    };
  }

  /** Tables, title area and closing lines of one sheet (CLEAN-69). */
  private structure(
    workbook: Awaited<ReturnType<typeof loadWorkbook>>,
    args: Args,
  ) {
    const sheetRef = requireSheet(args);
    const section = readSheet(workbook, sheetRef, {
      includeHidden: args.include_hidden,
      maxCells: MAX_QUERY_CELLS,
    });
    return {
      sheet: publicInfo(section.info),
      structure: detectSheetStructure(section.rows),
      warnings: section.warnings,
    };
  }

  private read(workbook: Awaited<ReturnType<typeof loadWorkbook>>, args: Args) {
    const sheetRef = requireSheet(args);
    const { section, restrict } = this.readForQuery(workbook, sheetRef, args, {
      maxRows: READ_MAX_ROWS,
    });
    const rows = (
      args.where
        ? section.rows.filter((r) => rowMatches(r, args.where!))
        : section.rows
    )
      .map(restrict)
      .filter((r) => r.cells.length);
    const warnings = [...section.warnings];
    if (section.truncated) {
      warnings.push(
        `only the first ${READ_MAX_ROWS} non-empty rows are listed (${section.omittedRows} more); narrow the range`,
      );
    }
    return {
      sheet: publicInfo(section.info),
      range: args.range ?? 'used area',
      rows,
      truncated: section.truncated,
      warnings,
    };
  }

  private aggregate(
    workbook: Awaited<ReturnType<typeof loadWorkbook>>,
    args: Args,
  ) {
    const sheetRef = requireSheet(args);
    if (!args.range) {
      throw new WorkbookReadError(
        'aggregate needs a range, e.g. "F5:F47" or "F:F".',
      );
    }
    if (!args.fn) {
      throw new WorkbookReadError(
        'aggregate needs fn: sum, min, max, count or avg.',
      );
    }
    const includeComputed = args.include_computed ?? true;
    const { section, bounds, restrict } = this.readForQuery(
      workbook,
      sheetRef,
      args,
      {},
    );
    const area =
      (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);

    const counted: CellRef[] = [];
    let nonNumeric = 0;
    let computedExcluded = 0;
    let mergedDuplicates = 0;
    let seen = 0;
    for (const fullRow of section.rows) {
      if (args.where && !rowMatches(fullRow, args.where)) continue;
      const row = restrict(fullRow);
      for (const cell of row.cells) {
        seen++;
        if (cell.span)
          mergedDuplicates += spanCellsInside(cell.span, bounds) - 1;
        if (cell.kind !== 'number' || typeof cell.value !== 'number') {
          nonNumeric++;
          continue;
        }
        if (cell.computed && !includeComputed) {
          computedExcluded++;
          continue;
        }
        counted.push(cell);
      }
    }

    const numbers = counted.map((c) => c.value as number);
    let value: number | null = null;
    if (numbers.length) {
      switch (args.fn) {
        case 'sum':
          value = trim(numbers.reduce((a, b) => a + b, 0));
          break;
        case 'min':
          value = Math.min(...numbers);
          break;
        case 'max':
          value = Math.max(...numbers);
          break;
        case 'count':
          value = numbers.length;
          break;
        case 'avg':
          value = trim(numbers.reduce((a, b) => a + b, 0) / numbers.length);
          break;
      }
    }

    return {
      sheet: publicInfo(section.info),
      fn: args.fn,
      range: formatRange(bounds),
      where: args.where ?? null,
      value,
      covered: {
        cellsCounted: counted.length,
        cellsSkipped: {
          empty: Math.max(0, area - seen - mergedDuplicates),
          nonNumeric,
          computedExcluded,
          mergedDuplicates,
        },
      },
      ...(counted.length <= AGGREGATE_LIST_CELLS
        ? {
            cells: counted.map((c) => ({
              address: c.address,
              value: c.value,
              computed: c.computed,
            })),
          }
        : {}),
      warnings: section.warnings,
    };
  }

  private find(workbook: Awaited<ReturnType<typeof loadWorkbook>>, args: Args) {
    const sheetRef = requireSheet(args);
    const needle = (args.query ?? '').trim().toLowerCase();
    if (!needle) throw new WorkbookReadError('find needs a non-empty query.');
    const section = readSheet(workbook, sheetRef, {
      includeHidden: args.include_hidden,
      maxCells: MAX_QUERY_CELLS,
    });
    const matches: Array<{
      address: string;
      value: CellRef['value'];
      rowCells: Array<{
        address: string;
        value: CellRef['value'];
        computed: boolean;
      }>;
    }> = [];
    let truncated = false;
    outer: for (const row of section.rows) {
      for (const cell of row.cells) {
        if (!cell.display.toLowerCase().includes(needle)) continue;
        if (matches.length >= FIND_MAX_MATCHES) {
          truncated = true;
          break outer;
        }
        matches.push({
          address: cell.address,
          value: cell.value,
          rowCells: row.cells
            .filter((c) => c !== cell)
            .map((c) => ({
              address: c.address,
              value: c.value,
              computed: c.computed,
            })),
        });
      }
    }
    return {
      sheet: publicInfo(section.info),
      query: args.query,
      matches,
      truncated,
    };
  }

  /**
   * Read the requested range — widened to include the `where` column when
   * the filter looks outside it, so "sum F where B contains X" works. The
   * returned `restrict` trims a row back to the range the caller asked for.
   */
  private readForQuery(
    workbook: Awaited<ReturnType<typeof loadWorkbook>>,
    sheetRef: string | number,
    args: Args,
    opts: { maxRows?: number },
  ) {
    const { sheet } = resolveSheet(workbook, sheetRef);
    const lastRow = Math.max(1, sheet.rowCount);
    const lastCol = Math.max(1, sheet.columnCount);
    const bounds = args.range
      ? parseA1Range(args.range, lastRow)
      : { top: 1, left: 1, bottom: lastRow, right: lastCol };

    let readBounds = bounds;
    if (args.where) {
      const col = columnNumber(args.where.column);
      readBounds = {
        ...bounds,
        left: Math.min(bounds.left, col),
        right: Math.max(bounds.right, col),
      };
    }

    const section = readSheet(workbook, sheetRef, {
      range: formatRange(readBounds),
      includeHidden: args.include_hidden,
      maxRows: opts.maxRows,
      maxCells: MAX_QUERY_CELLS,
    });
    // Report the clip against the requested range, not the widened one.
    const clippedBounds = {
      top: Math.max(1, bounds.top),
      left: Math.max(1, bounds.left),
      bottom: Math.min(bounds.bottom, lastRow),
      right: Math.min(bounds.right, lastCol),
    };
    const restrict = (row: CellRow): CellRow => ({
      row: row.row,
      cells: row.cells.filter((c) => {
        const col = columnNumber(columnOf(c.address));
        return col >= clippedBounds.left && col <= clippedBounds.right;
      }),
    });
    return { section, bounds: clippedBounds, restrict };
  }

  private extractAgentId(
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): string | null {
    const sub = httpRequest?.user?.sub ?? '';
    if (!sub.startsWith('agent:')) return null;
    return sub.slice('agent:'.length);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

function requireSheet(args: Args): string | number {
  if (args.sheet === undefined || args.sheet === '') {
    throw new WorkbookReadError(
      `${args.op} needs a sheet (name or 1-based index); call describe to list them.`,
    );
  }
  return args.sheet;
}

function publicInfo(info: SheetInfo) {
  return {
    index: info.index,
    name: info.name,
    state: info.state,
    usedRows: info.usedRows,
    usedCols: info.usedCols,
  };
}

function rowMatches(row: CellRow, where: NonNullable<Args['where']>): boolean {
  const column = where.column.toUpperCase();
  const cell = row.cells.find((c) => columnOf(c.address) === column);
  if (!cell) return where.op === 'ne';
  const v = cell.value;
  switch (where.op) {
    case 'eq':
      return String(v).toLowerCase() === String(where.value).toLowerCase();
    case 'ne':
      return String(v).toLowerCase() !== String(where.value).toLowerCase();
    case 'contains':
      return String(v)
        .toLowerCase()
        .includes(String(where.value).toLowerCase());
    case 'gt':
      return typeof v === 'number' && v > Number(where.value);
    case 'lt':
      return typeof v === 'number' && v < Number(where.value);
  }
}

/** Cells of a merged span that fall inside the queried bounds. */
function spanCellsInside(
  span: string,
  bounds: ReturnType<typeof parseA1Range>,
): number {
  const s = parseA1Range(span);
  const top = Math.max(s.top, bounds.top);
  const bottom = Math.min(s.bottom, bounds.bottom);
  const left = Math.max(s.left, bounds.left);
  const right = Math.min(s.right, bounds.right);
  if (bottom < top || right < left) return 1;
  return (bottom - top + 1) * (right - left + 1);
}

function trim(n: number): number {
  return Number(n.toPrecision(15));
}
