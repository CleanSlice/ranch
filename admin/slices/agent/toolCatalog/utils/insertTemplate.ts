/**
 * Dropping a tool's starter template into the composer (CLEAN-109). Pure so
 * it can be tested without a textarea. The template is a starter, not a
 * form: the person keeps editing after it lands.
 */

export interface IInsertion {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const PLACEHOLDER = /«[^»]*»/;

/** [start, end) of the first «…» at or after `from`, or null. */
export function firstPlaceholderRange(
  text: string,
  from = 0,
): [number, number] | null {
  const match = PLACEHOLDER.exec(text.slice(from));
  if (!match) return null;
  const start = from + match.index;
  return [start, start + match[0].length];
}

export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

/**
 * Inserts `template` at `cursor` in `draft`, with a space on either side when
 * the neighbouring text does not already provide one. The selection lands on
 * the first placeholder of the inserted text so the person can type over it,
 * or at the end of the insertion when there is none.
 */
export function insertTemplate(
  draft: string,
  cursor: number,
  template: string,
): IInsertion {
  const at = Math.max(0, Math.min(cursor, draft.length));
  const before = draft.slice(0, at);
  const after = draft.slice(at);

  const needsLeading = before.length > 0 && !/\s$/.test(before);
  const needsTrailing = after.length > 0 && !/^\s/.test(after);

  const inserted = (needsLeading ? ' ' : '') + template + (needsTrailing ? ' ' : '');
  const text = before + inserted + after;

  const insertionStart = before.length + (needsLeading ? 1 : 0);
  const insertionEnd = insertionStart + template.length;

  const range = firstPlaceholderRange(text, insertionStart);
  if (range && range[0] < insertionEnd) {
    return { text, selectionStart: range[0], selectionEnd: range[1] };
  }
  return { text, selectionStart: insertionEnd, selectionEnd: insertionEnd };
}
