/**
 * Citation markers in an agent's markdown (CLEAN-138).
 *
 * The runtime leaves `[^n]` after the sentences a source supports and sends
 * the list of sources separately. Before the markdown is parsed, every marker
 * outside code becomes a chip — the reader must never see the raw form —
 * and the list under the bubble is what the chip points at.
 *
 * Three modes, decided by the message's state:
 *   - `numbered`: the final text; the chip shows its number and is clickable.
 *   - `pending`:  still streaming; the model's numbers are not final yet, so
 *                 the chip is a neutral dot.
 *   - `strip`:    a text that is known to carry no list; the marker is removed.
 *
 * TWIN: admin/slices/bridle/utils/citations.ts does the same for the admin
 * console. Change one, change the other.
 */

export type CitationModes = 'numbered' | 'pending' | 'strip';

/** `[^12]` — up to three digits; anything longer is not a citation of ours. */
const MARKER = /\[\^(\d{1,3})\]/g;

/**
 * Fenced blocks, indented-by-tilde blocks and inline spans. Splitting on a
 * capture group keeps the code segments at the odd indexes, untouched.
 */
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;

export function markCitations(markdown: string, mode: CitationModes): string {
  if (!markdown || !markdown.includes('[^')) return markdown;
  return markdown
    .split(CODE)
    .map((segment, i) => (i % 2 === 1 ? segment : markSegment(segment, mode)))
    .join('');
}

/** Every marker outside code removed, along with the space before it. */
export function stripCitations(markdown: string): string {
  return markCitations(markdown, 'strip');
}

function markSegment(text: string, mode: CitationModes): string {
  if (mode === 'strip') return text.replace(/ ?\[\^\d{1,3}\]/g, '');
  return text.replace(MARKER, (_m, n: string) =>
    mode === 'numbered'
      ? `<sup class="chat-cite" data-n="${n}" role="button" tabindex="0">${n}</sup>`
      : `<sup class="chat-cite chat-cite--pending" aria-hidden="true"></sup>`,
  );
}

/** The number a clicked chip carries, or null when the click was elsewhere. */
export function citationNumberOf(target: EventTarget | null): number | null {
  const el = (target as HTMLElement | null)?.closest?.('.chat-cite[data-n]');
  if (!el) return null;
  const n = Number(el.getAttribute('data-n'));
  return Number.isInteger(n) && n > 0 ? n : null;
}
