/**
 * A table's rows say nothing about which document they belong to
 * (CLEAN-195). On the reference base the 26MY Mazda3 spec deck's
 * "Specifications.csv" holds "Weights and Capacities,Fuel Tank Capacity
 * (gallons),,FWD 13.2 / AWD 12.7": no model, no year — those live only in
 * the file name — so a question that names them never lands on the chunk,
 * while a question worded like the row retrieves it at once. A header at
 * the top of the file would not do: the retrieval service chunks by tokens
 * and the second chunk loses it. So every row goes in carrying the
 * document's name and its column labels.
 */

import type { ISourceData } from './source.types';

/** A source whose content is one record per row. */
export function isTabularSource(
  source: Pick<ISourceData, 'type' | 'mimeType' | 'name'>,
): boolean {
  if (source.type !== 'file') return false;
  return source.mimeType === 'text/csv' || /\.csv$/i.test(source.name);
}

/** The delimiter a CSV uses: whichever of the three its first line has most of. */
function delimiterOf(firstLine: string): string {
  let best = ',';
  let bestCount = -1;
  for (const candidate of [',', ';', '\t']) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC 4180 rows: a cell in double quotes may hold the delimiter, a line
 * break and a doubled quote. Line ends are CRLF or LF.
 */
export function parseCsv(csv: string): string[][] {
  const delimiter = delimiterOf(csv.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** The document's name as a row prefix: the extension says nothing. */
function titleOf(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || name;
}

/**
 * One line per data row: the document's title, then every non-empty cell
 * as "label: value" (the value alone when its column has no label). Null
 * when the text is not a table — fewer than two rows, or a single column —
 * so the caller falls back to the plain file.
 */
export function tabularRowsText(name: string, csv: string): string | null {
  const rows = parseCsv(csv);
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => h.trim());
  if (header.filter((h) => h !== '').length < 2) return null;
  const title = titleOf(name);
  const lines: string[] = [];
  for (const row of rows.slice(1)) {
    const cells: string[] = [];
    row.forEach((raw, i) => {
      const value = raw.trim();
      if (value === '') return;
      const label = header[i] ?? '';
      cells.push(label ? `${label}: ${value}` : value);
    });
    if (cells.length > 0) lines.push([title, ...cells].join(' | '));
  }
  return lines.length > 0 ? lines.join('\n') : null;
}
