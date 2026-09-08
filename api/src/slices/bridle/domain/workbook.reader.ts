/**
 * One reader for everything that looks at an attached workbook: the inline
 * preview the model receives and the `query_attachment` tool it calls for
 * exact numbers. Sharing the reader is what guarantees the two agree on
 * every value — a merged region counts once, a formula cell is flagged as
 * computed, a hidden sheet stays out unless asked for.
 *
 * Shapes are documented in specs/009-attachment-parse-quality/data-model.md.
 */
import { ValueType, Workbook } from 'exceljs';
import type { Cell, CellValue, Worksheet } from 'exceljs';

export type SheetState = 'visible' | 'hidden' | 'veryHidden';

export interface SheetInfo {
  /** 1-based position in the workbook. */
  index: number;
  name: string;
  state: SheetState;
  /** Rows carrying any value (merged continuations included). */
  usedRows: number;
  usedCols: number;
  mergedRegions: number;
}

export interface WorkbookSummary {
  sheets: SheetInfo[];
}

export type CellKind = 'text' | 'number' | 'boolean' | 'date' | 'error';

export interface CellRef {
  /** A1 address of the cell (for a merged region: its master). */
  address: string;
  /** `A1:AN1` when this cell is the master of a merged region. */
  span?: string;
  kind: CellKind;
  value: string | number | boolean | null;
  /** What gets printed: trimmed floats, ISO dates, percent, error text. */
  display: string;
  /** True for formula cells — `value` is the cached result. */
  computed: boolean;
  error?: string;
}

export interface CellRow {
  row: number;
  cells: CellRef[];
}

export interface SheetSection {
  info: SheetInfo;
  /** Only rows that yielded at least one cell, in order. */
  rows: CellRow[];
  /** First and last emitted row numbers; null when nothing was emitted. */
  includedRows: [number, number] | null;
  /** Non-empty rows in range that were dropped by `maxRows` / `maxCells`. */
  omittedRows: number;
  truncated: boolean;
  warnings: string[];
}

export interface RangeBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface ReadSheetOptions {
  /** A1 range (`B4:F12`), single cell (`F12`) or column span (`F:F`). */
  range?: string;
  includeHidden?: boolean;
  /** Cap on non-empty rows emitted; the rest is counted in `omittedRows`. */
  maxRows?: number;
  /** Cap on the rectangular area the range may cover. */
  maxCells?: number;
}

/** A caller error: bad sheet, bad range, hidden sheet, over the cell cap. */
export class WorkbookReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookReadError';
  }
}

export async function loadWorkbook(body: Buffer): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  return workbook;
}

export function describeWorkbook(workbook: Workbook): WorkbookSummary {
  const sheets: SheetInfo[] = [];
  workbook.eachSheet((sheet, id) => {
    void id;
    sheets.push(sheetInfo(sheet, sheets.length + 1));
  });
  return { sheets };
}

/** Sheet by 1-based index or by name (exact first, then case-insensitive). */
export function resolveSheet(
  workbook: Workbook,
  ref: string | number,
): { sheet: Worksheet; index: number } {
  const all: Worksheet[] = [];
  workbook.eachSheet((s) => {
    all.push(s);
  });
  if (typeof ref === 'number') {
    const sheet = all[ref - 1];
    if (sheet) return { sheet, index: ref };
  } else {
    const wanted = ref.trim();
    let i = all.findIndex((s) => s.name === wanted);
    if (i === -1) {
      i = all.findIndex((s) => s.name.toLowerCase() === wanted.toLowerCase());
    }
    if (i !== -1) return { sheet: all[i], index: i + 1 };
  }
  const available = all
    .map((s, i) => `${i + 1} "${s.name}"${stateOf(s) === 'visible' ? '' : ` (${stateOf(s)})`}`)
    .join(', ');
  throw new WorkbookReadError(
    `Sheet ${typeof ref === 'number' ? ref : `"${ref}"`} not found; available: ${available}`,
  );
}

const CELL_RE = /^([A-Z]{1,3})(\d+)$/i;
const RANGE_RE = /^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/i;
const COLUMNS_RE = /^([A-Z]{1,3}):([A-Z]{1,3})$/i;

/** Parse A1 notation. Column-only spans need `lastRow` to close them. */
export function parseA1Range(range: string, lastRow = 1): RangeBounds {
  const trimmed = range.trim();
  let m = RANGE_RE.exec(trimmed);
  if (m) {
    return normalise({
      top: Number(m[2]),
      left: columnNumber(m[1]),
      bottom: Number(m[4]),
      right: columnNumber(m[3]),
    });
  }
  m = CELL_RE.exec(trimmed);
  if (m) {
    const row = Number(m[2]);
    const col = columnNumber(m[1]);
    return { top: row, left: col, bottom: row, right: col };
  }
  m = COLUMNS_RE.exec(trimmed);
  if (m) {
    return normalise({
      top: 1,
      left: columnNumber(m[1]),
      bottom: Math.max(1, lastRow),
      right: columnNumber(m[2]),
    });
  }
  throw new WorkbookReadError('range must be A1 notation like "B5:F47".');
}

function normalise(b: RangeBounds): RangeBounds {
  return {
    top: Math.min(b.top, b.bottom),
    bottom: Math.max(b.top, b.bottom),
    left: Math.min(b.left, b.right),
    right: Math.max(b.left, b.right),
  };
}

export function columnLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function formatRange(b: RangeBounds): string {
  return `${columnLetter(b.left)}${b.top}:${columnLetter(b.right)}${b.bottom}`;
}

/**
 * Read one sheet as coordinate-addressed rows. Merged regions appear once
 * (at their master cell, with `span`), continuation cells never do; rows
 * that end up with no cells are not emitted, so gaps show as jumps in the
 * row numbers.
 */
export function readSheet(
  workbook: Workbook,
  ref: string | number,
  opts: ReadSheetOptions = {},
): SheetSection {
  const { sheet, index } = resolveSheet(workbook, ref);
  const info = sheetInfo(sheet, index);
  if (info.state !== 'visible' && !opts.includeHidden) {
    throw new WorkbookReadError(
      `Sheet "${info.name}" is hidden; pass include_hidden: true to read it.`,
    );
  }

  const warnings: string[] = [];
  const lastRow = Math.max(1, sheet.rowCount);
  const lastCol = Math.max(1, sheet.columnCount);
  let bounds: RangeBounds = opts.range
    ? parseA1Range(opts.range, lastRow)
    : { top: 1, left: 1, bottom: lastRow, right: lastCol };

  const clipped: RangeBounds = {
    top: Math.max(1, bounds.top),
    left: Math.max(1, bounds.left),
    bottom: Math.min(bounds.bottom, lastRow),
    right: Math.min(bounds.right, lastCol),
  };
  if (
    clipped.top !== bounds.top ||
    clipped.left !== bounds.left ||
    clipped.bottom !== bounds.bottom ||
    clipped.right !== bounds.right
  ) {
    warnings.push(
      `range clipped to the used area ${formatRange(clipped)}`,
    );
    bounds = clipped;
  }
  if (bounds.bottom < bounds.top || bounds.right < bounds.left) {
    return { info, rows: [], includedRows: null, omittedRows: 0, truncated: false, warnings };
  }

  const area = (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
  if (opts.maxCells !== undefined && area > opts.maxCells) {
    throw new WorkbookReadError(
      `Range covers ${area.toLocaleString('en-US')} cells; narrow it below ${opts.maxCells.toLocaleString('en-US')}.`,
    );
  }

  const spans = mergedSpans(sheet);
  const rows: CellRow[] = [];
  let omitted = 0;
  let truncated = false;
  const maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < bounds.top || rowNumber > bounds.bottom) return;
    const cells: CellRef[] = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber < bounds.left || colNumber > bounds.right) return;
      const ref = normalizeCell(cell, spans);
      if (ref) cells.push(ref);
    });
    if (!cells.length) return;
    if (rows.length >= maxRows) {
      omitted++;
      truncated = true;
      return;
    }
    rows.push({ row: rowNumber, cells });
  });

  return {
    info,
    rows,
    includedRows: rows.length
      ? [rows[0].row, rows[rows.length - 1].row]
      : null,
    omittedRows: omitted,
    truncated,
    warnings,
  };
}

/**
 * First row with at least two text cells — where a table's column labels
 * usually are. Advisory: exports put titles above the header all the time.
 */
export function guessHeader(
  rows: CellRow[],
): { row: number; cells: Record<string, string> } | null {
  for (const r of rows) {
    const text = r.cells.filter((c) => c.kind === 'text' && !c.computed);
    if (text.length >= 2) {
      const cells: Record<string, string> = {};
      for (const c of text) cells[columnOf(c.address)] = String(c.value);
      return { row: r.row, cells };
    }
  }
  return null;
}

export function columnOf(address: string): string {
  return address.replace(/\d+$/, '');
}

// ─── cells ──────────────────────────────────────────────────────────────

/** Master address → `A1:AN1` for every merged region on the sheet. */
function mergedSpans(sheet: Worksheet): Map<string, string> {
  const out = new Map<string, string>();
  // `_merges` is exceljs's own index keyed by master address; reading it
  // avoids `sheet.model`, which serialises every row just to list merges.
  const raw = (sheet as unknown as { _merges?: Record<string, { range?: string }> })
    ._merges;
  if (raw) {
    for (const [master, dims] of Object.entries(raw)) {
      if (dims?.range) out.set(master, dims.range);
    }
    return out;
  }
  for (const range of sheet.model.merges ?? []) {
    out.set(range.split(':')[0], range);
  }
  return out;
}

/**
 * One cell as the model should see it, or null when the cell contributes
 * nothing (empty, or a continuation of a merged region).
 */
export function normalizeCell(
  cell: Cell,
  spans?: Map<string, string>,
): CellRef | null {
  if (cell.type === ValueType.Null || cell.type === ValueType.Merge) return null;

  const computed = cell.type === ValueType.Formula;
  const raw: CellValue = computed ? (cell.result as CellValue) : cell.value;
  const span = spans?.get(cell.address);

  if (computed && (raw === null || raw === undefined)) {
    return {
      address: cell.address,
      ...(span ? { span } : {}),
      kind: 'text',
      value: null,
      display: '(formula, no cached value)',
      computed: true,
    };
  }

  const norm = normalizeValue(raw, cell.numFmt);
  if (norm === null) return null;
  return {
    address: cell.address,
    ...(span ? { span } : {}),
    kind: norm.kind,
    value: norm.value,
    display: norm.display,
    computed,
    ...(norm.error ? { error: norm.error } : {}),
  };
}

interface NormalizedValue {
  kind: CellKind;
  value: string | number | boolean | null;
  display: string;
  error?: string;
}

function textValue(text: string): NormalizedValue | null {
  return text.trim().length ? { kind: 'text', value: text, display: text } : null;
}

function normalizeValue(
  raw: CellValue,
  numFmt: string | undefined,
): NormalizedValue | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    const value = trimFloat(raw);
    if (numFmt && numFmt.includes('%')) {
      return { kind: 'number', value, display: `${trimFloat(value * 100)}%` };
    }
    return { kind: 'number', value, display: String(value) };
  }
  if (typeof raw === 'string') return textValue(raw);
  if (typeof raw === 'boolean') {
    return { kind: 'boolean', value: raw, display: String(raw) };
  }
  if (raw instanceof Date) {
    const display = formatDate(raw);
    return { kind: 'date', value: display, display };
  }
  if (typeof raw === 'object') {
    if ('error' in raw) {
      const error = String(raw.error);
      return { kind: 'error', value: error, display: error, error };
    }
    if ('richText' in raw) {
      return textValue(raw.richText.map((r) => r.text).join(''));
    }
    if ('result' in raw) {
      return normalizeValue(raw.result as CellValue, numFmt);
    }
    if ('text' in raw) {
      // Hyperlink cells: `text` is a string or a rich-text run list.
      const t = raw.text as unknown;
      return textValue(
        typeof t === 'string'
          ? t
          : ((t as { richText?: Array<{ text: string }> })?.richText ?? [])
              .map((r) => r.text)
              .join(''),
      );
    }
  }
  return null;
}

/** `0.30000000000000004` → `0.3`; leaves integers and money alone. */
export function trimFloat(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Number(n.toPrecision(15));
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD`, or `YYYY-MM-DD HH:mm` when the cell carries a time. */
export function formatDate(d: Date): string {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hasTime =
    d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  return hasTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

// ─── sheets ─────────────────────────────────────────────────────────────

function stateOf(sheet: Worksheet): SheetState {
  const s = (sheet as unknown as { state?: string }).state;
  return s === 'hidden' || s === 'veryHidden' ? s : 'visible';
}

function sheetInfo(sheet: Worksheet, index: number): SheetInfo {
  const raw = (sheet as unknown as { _merges?: Record<string, unknown> })._merges;
  const mergedRegions = raw
    ? Object.keys(raw).length
    : (sheet.model.merges?.length ?? 0);
  return {
    index,
    name: sheet.name,
    state: stateOf(sheet),
    usedRows: sheet.actualRowCount,
    usedCols: sheet.actualColumnCount,
    mergedRegions,
  };
}
