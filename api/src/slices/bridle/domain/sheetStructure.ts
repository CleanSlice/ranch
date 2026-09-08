/**
 * The shape of a sheet, from layout alone.
 *
 * Exports from accounting systems put a title block on top, one or more
 * dense tables in the middle, and closing lines underneath — one label and
 * one number per row: subtotal, tax, discount, transport, amount to pay.
 * The model reads those closing lines best when they are listed together,
 * with their cells, apart from the item rows.
 *
 * Deliberately no vocabulary: a "closing line" is a sparse row with a text
 * next to a number, whatever the text says. What a line means for a given
 * question is the agent's call (CLEAN-69).
 */
import {
  columnLetter,
  columnNumber,
  columnOf,
  type CellRef,
  type CellRow,
} from './workbook.reader';

/** Rows with at least this many cells are "dense" — wide enough for a table. */
export const DENSE_ROW_MIN_CELLS = 3;
/**
 * A table needs at least this many dense rows (header included). A lone
 * dense row is a closing line with two label/number pairs on it
 * ("Всього | 20 | Всього без ПДВ | 82"), not a one-row table.
 */
export const TABLE_MIN_ROWS = 2;
/**
 * A run of two-cell rows (key | value) becomes a table only from this many
 * rows on. Shorter runs are closing lines — subtotal, tax, transport, amount
 * to pay — and stay with the pairs where the model reads them side by side.
 */
export const KV_TABLE_MIN_ROWS = 8;
/** Share of columns two consecutive rows must share to sit in one run. */
export const RUN_COLUMN_OVERLAP = 0.6;
/** Pairs/lines listed per segment in the preview before "(+N more)". */
export const STRUCTURE_MAX_ITEMS_PER_SEGMENT = 40;
/** Share of text cells for a block's first row to count as its header. */
export const HEADER_TEXT_RATIO = 0.6;
/** A row of integers 1..n (n ≤ this) right under the header numbers columns. */
export const INDEX_ROW_MAX_VALUE = 200;

export interface LabelValuePair {
  row: number;
  /** Nearest text on the row (left preferred, then right); null when none. */
  label: string | null;
  labelCell?: string;
  labelSpan?: string;
  value: number;
  valueCell: string;
  computed: boolean;
  display: string;
}

export interface TextLine {
  row: number;
  /** First text cell on the row. */
  cell: string;
  /** Span of that cell when it is a merged master. */
  span?: string;
  /** All text cells on the row, joined with ` · `. */
  text: string;
}

export interface Segment {
  pairs: LabelValuePair[];
  lines: TextLine[];
}

export interface TableBlock {
  range: string;
  headerRow: number | null;
  headerCells: Record<string, string>;
  indexRow: number | null;
  dataRows: [number, number] | null;
  rowCount: number;
  /** Rows after this block until the next block. */
  footer: Segment;
}

export interface SheetStructure {
  /** Rows before the first table — or every row when there is no table. */
  title: Segment;
  tables: TableBlock[];
}

function isDense(row: CellRow): boolean {
  return row.cells.length >= DENSE_ROW_MIN_CELLS;
}

function isTextCell(c: CellRef): boolean {
  return c.kind === 'text' || c.kind === 'date';
}

function isNumberCell(c: CellRef): boolean {
  return c.kind === 'number' && typeof c.value === 'number';
}

function colsOf(row: CellRow): Set<string> {
  return new Set(row.cells.map((c) => columnOf(c.address)));
}

function textColsOf(row: CellRow): Set<string> {
  return new Set(
    row.cells.filter((c) => c.kind === 'text').map((c) => columnOf(c.address)),
  );
}

/** Shared columns over the narrower row: 1 when one row's columns ⊆ the other's. */
function overlap(a: CellRow, b: CellRow): number {
  const ca = colsOf(a);
  const cb = colsOf(b);
  let shared = 0;
  for (const c of ca) if (cb.has(c)) shared++;
  return shared / Math.max(1, Math.min(ca.size, cb.size));
}

function textRatio(row: CellRow): number {
  return row.cells.filter(isTextCell).length / Math.max(1, row.cells.length);
}

/**
 * Split rows into runs, then carve tables out of each run.
 *
 * A run is consecutive rows with two or more cells that share most of their
 * columns. Inside a run, a table is a header (mostly text) plus data rows
 * that keep the same *signature* — text in the same columns. The first row
 * whose text lands in a column that held numbers so far is where the table
 * ends: that is a closing line ("Всього | 20 | Всього без ПДВ | 82") even
 * when it sits right under the last item. Everything that is not a table
 * goes to the title (before the first table) or to the footer of the table
 * it follows, where the pairs are read.
 */
export function detectSheetStructure(rows: CellRow[]): SheetStructure {
  const title: CellRow[] = [];
  const blocks: Array<{ rows: CellRow[]; footer: CellRow[] }> = [];

  const loose = (row: CellRow): void => {
    if (!blocks.length) title.push(row);
    else blocks[blocks.length - 1].footer.push(row);
  };

  const processRun = (run: CellRow[]): void => {
    if (!run.length) return;
    let i = 0;
    if (textRatio(run[0]) >= HEADER_TEXT_RATIO) {
      i = 1;
      if (run[i] && isIndexRow(run[i])) i++;
    }
    // Data signature from the first data row; a row whose text columns are
    // not a subset of it belongs to whatever comes after the table.
    let j = i;
    if (j < run.length) {
      const signature = textColsOf(run[j]);
      j++;
      while (j < run.length) {
        const text = textColsOf(run[j]);
        let fits = true;
        for (const c of text) {
          if (!signature.has(c)) {
            fits = false;
            break;
          }
        }
        if (!fits) break;
        j++;
      }
    }
    const tableRows = run.slice(0, j);
    const rest = run.slice(j);
    const denseCount = tableRows.filter(isDense).length;
    const qualifies =
      tableRows.length >= TABLE_MIN_ROWS &&
      (denseCount >= TABLE_MIN_ROWS || tableRows.length >= KV_TABLE_MIN_ROWS);
    if (qualifies) {
      blocks.push({ rows: tableRows, footer: [] });
    } else {
      for (const r of tableRows) loose(r);
    }
    // The breaking row may start a table of its own (a second block).
    if (rest.length) {
      if (rest.length === run.length) {
        // No progress possible (single unplaceable row): keep it loose.
        for (const r of rest) loose(r);
        return;
      }
      processRun(rest);
    }
  };

  let run: CellRow[] = [];
  for (const row of rows) {
    const last = run[run.length - 1];
    const joins =
      row.cells.length >= 2 &&
      (!last ||
        (row.row === last.row + 1 && overlap(last, row) >= RUN_COLUMN_OVERLAP));
    if (joins) {
      run.push(row);
      continue;
    }
    processRun(run);
    run = row.cells.length >= 2 ? [row] : [];
    if (row.cells.length < 2) loose(row);
  }
  processRun(run);

  return {
    title: segment(title),
    tables: blocks.map((b) => tableBlock(b.rows, b.footer)),
  };
}

function segment(rows: CellRow[]): Segment {
  const pairs: LabelValuePair[] = [];
  const lines: TextLine[] = [];
  for (const row of rows) {
    const numbers = row.cells.filter(isNumberCell);
    const texts = row.cells.filter(isTextCell);
    if (!numbers.length) {
      if (texts.length) {
        lines.push({
          row: row.row,
          cell: texts[0].address,
          ...(texts[0].span ? { span: texts[0].span } : {}),
          text: texts.map((t) => t.display).join(' · '),
        });
      }
      continue;
    }
    for (const n of numbers) {
      const col = columnNumber(columnOf(n.address));
      const left = texts.filter((t) => columnNumber(columnOf(t.address)) < col);
      const right = texts.filter(
        (t) => columnNumber(columnOf(t.address)) > col,
      );
      const label = left.length ? left[left.length - 1] : (right[0] ?? null);
      pairs.push({
        row: row.row,
        label: label ? label.display : null,
        ...(label ? { labelCell: label.address } : {}),
        ...(label?.span ? { labelSpan: label.span } : {}),
        value: n.value as number,
        valueCell: n.address,
        computed: n.computed,
        display: n.display,
      });
    }
  }
  return { pairs, lines };
}

function tableBlock(rows: CellRow[], footer: CellRow[]): TableBlock {
  let left = Number.POSITIVE_INFINITY;
  let right = 0;
  for (const r of rows) {
    for (const c of r.cells) {
      const col = columnNumber(columnOf(c.address));
      if (col < left) left = col;
      if (col > right) right = col;
    }
  }
  const range = `${columnLetter(left)}${rows[0].row}:${columnLetter(right)}${rows[rows.length - 1].row}`;

  let cursor = 0;
  let headerRow: number | null = null;
  const headerCells: Record<string, string> = {};
  const first = rows[0];
  const textShare =
    first.cells.filter(isTextCell).length / Math.max(1, first.cells.length);
  if (textShare >= HEADER_TEXT_RATIO) {
    headerRow = first.row;
    for (const c of first.cells) {
      // Labels only: a date in the header row is a value, not a column name.
      if (c.kind === 'text') headerCells[columnOf(c.address)] = c.display;
    }
    cursor = 1;
  }

  let indexRow: number | null = null;
  if (headerRow !== null && rows[cursor] && isIndexRow(rows[cursor])) {
    indexRow = rows[cursor].row;
    cursor++;
  }

  const data = rows.slice(cursor);
  return {
    range,
    headerRow,
    headerCells,
    indexRow,
    dataRows: data.length ? [data[0].row, data[data.length - 1].row] : null,
    rowCount: data.length,
    footer: segment(footer),
  };
}

/** `1 | 2 | 3 | …` under a header: column numbering, not data. */
function isIndexRow(row: CellRow): boolean {
  if (row.cells.length < DENSE_ROW_MIN_CELLS) return false;
  let expected = 1;
  for (const c of row.cells) {
    if (!isNumberCell(c) || c.computed) return false;
    const v = c.value as number;
    if (!Number.isInteger(v) || v !== expected || v > INDEX_ROW_MAX_VALUE) {
      return false;
    }
    expected++;
  }
  return true;
}

// ─── preview rendering ──────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '⏎');
}

function formatPair(p: LabelValuePair): string {
  const value = `${p.valueCell}=${p.computed ? '[=]' : ''}${esc(p.display)}`;
  if (p.label === null || !p.labelCell) return value;
  const cell = p.labelSpan ? `${p.labelCell}[${p.labelSpan}]` : p.labelCell;
  return `${cell} "${esc(p.label)}" → ${value}`;
}

function formatLine(l: TextLine): string {
  const cell = l.span ? `${l.cell}[${l.span}]` : l.cell;
  return `${cell} "${esc(l.text)}"`;
}

/** Pairs and lines of one segment, interleaved in row order. */
function formatSegment(s: Segment): string {
  const items: Array<{ row: number; col: number; text: string }> = [
    ...s.pairs.map((p) => ({
      row: p.row,
      col: columnNumber(columnOf(p.valueCell)),
      text: formatPair(p),
    })),
    ...s.lines.map((l) => ({
      row: l.row,
      col: columnNumber(columnOf(l.cell)),
      text: formatLine(l),
    })),
  ];
  items.sort((a, b) => a.row - b.row || a.col - b.col);
  const shown = items.slice(0, STRUCTURE_MAX_ITEMS_PER_SEGMENT);
  const more = items.length - shown.length;
  return (
    shown.map((i) => i.text).join(' · ') + (more > 0 ? ` (+${more} more)` : '')
  );
}

function formatTable(t: TableBlock): string {
  const header =
    t.headerRow === null
      ? 'header none'
      : `header R${t.headerRow}${t.indexRow !== null ? `+R${t.indexRow}` : ''}: ` +
        Object.entries(t.headerCells)
          .map(([col, label]) => `${col}=${esc(label)}`)
          .join(' | ');
  const data = t.dataRows
    ? `data R${t.dataRows[0]}–R${t.dataRows[1]}`
    : 'data none';
  return `${t.range} (${header}; ${data})`;
}

/**
 * The `title:` / `tables:` / `after <range>:` lines for the preview —
 * contract in specs/011-sheet-structure/contracts/sheet-structure.md.
 */
export function formatStructureLines(structure: SheetStructure): string[] {
  const out: string[] = [];
  const title = formatSegment(structure.title);
  if (title) out.push(`title: ${title}`);
  if (structure.tables.length) {
    out.push(`tables: ${structure.tables.map(formatTable).join('; ')}`);
    for (const t of structure.tables) {
      const after = formatSegment(t.footer);
      if (after) out.push(`after ${t.range}: ${after}`);
    }
  }
  return out;
}
