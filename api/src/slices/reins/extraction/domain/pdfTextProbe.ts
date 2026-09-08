/**
 * Does this PDF carry enough of its own text to skip OCR?
 *
 * Measured per page, not per document: a 200-page manual with one blank
 * page must not be sent to OCR, and a one-page scan with a stray printed
 * header must. Forty non-whitespace characters is well under a single
 * sentence, so anything that fails it is a scan with at most a page number
 * or a letterhead in its text layer - and Textract will read the rest better
 * than that header represents it.
 *
 * A constant rather than a setting: nobody tunes this, and a setting would
 * invite tuning it to hide a broken file instead of fixing it.
 */
export const MIN_TEXT_CHARS_PER_PAGE = 40;

export function hasUsableTextLayer(text: string, pages: number): boolean {
  if (pages <= 0) return false;
  const chars = text.replace(/\s+/g, '').length;
  return chars / pages >= MIN_TEXT_CHARS_PER_PAGE;
}
