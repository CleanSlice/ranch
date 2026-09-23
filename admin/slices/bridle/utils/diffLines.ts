/**
 * Unified diff → rows the card can paint (CLEAN-112). Only what a bounded
 * inline diff needs: hunk headers, context/added/removed lines with their
 * line numbers on the new side (old side for removals).
 */

export type DiffRowKind = 'hunk' | 'context' | 'add' | 'remove';

export interface IDiffRow {
  kind: DiffRowKind;
  /** Line number shown in the gutter (new side; old side for removals). */
  line: number | null;
  text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(patch: string): IDiffRow[] {
  const rows: IDiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    const m = HUNK.exec(raw);
    if (m) {
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      inHunk = true;
      rows.push({ kind: 'hunk', line: null, text: raw });
      continue;
    }
    if (!inHunk) continue; // file headers (---/+++/Index) are not rows
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === '+') {
      rows.push({ kind: 'add', line: newLine, text });
      newLine++;
    } else if (mark === '-') {
      rows.push({ kind: 'remove', line: oldLine, text });
      oldLine++;
    } else if (mark === ' ') {
      rows.push({ kind: 'context', line: newLine, text });
      oldLine++;
      newLine++;
    } else if (raw === '') {
      // A trailing empty line after the last hunk carries nothing.
      continue;
    }
  }
  return rows;
}

/** `+a −d` counts from parsed rows (when the API did not send them). */
export function countRows(rows: readonly IDiffRow[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const r of rows) {
    if (r.kind === 'add') additions++;
    else if (r.kind === 'remove') deletions++;
  }
  return { additions, deletions };
}
