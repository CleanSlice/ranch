import { hasUsableTextLayer, MIN_TEXT_CHARS_PER_PAGE } from './pdfTextProbe';

describe('hasUsableTextLayer', () => {
  it('treats a document with a full text layer as text', () => {
    const page = 'The Mazda CX-5 comes in five trim levels for 2026. '.repeat(4);
    expect(hasUsableTextLayer(page.repeat(3), 3)).toBe(true);
  });

  it('treats an empty text layer as a scan', () => {
    expect(hasUsableTextLayer('', 1)).toBe(false);
    expect(hasUsableTextLayer('   \n\t  ', 1)).toBe(false);
  });

  it('treats a scan with only a stray header as a scan', () => {
    // A printed page number and a letterhead survive as text on many scans;
    // that is not a text layer worth indexing.
    expect(hasUsableTextLayer('Page 1 of 1\nMAZDA', 1)).toBe(false);
  });

  it('measures per page, so one blank page in a manual does not trigger OCR', () => {
    // 199 pages with a normal amount of text, one page that is a photo.
    const text = 'x'.repeat(MIN_TEXT_CHARS_PER_PAGE * 10 * 199);
    expect(hasUsableTextLayer(text, 200)).toBe(true);
  });

  it('ignores whitespace when counting', () => {
    const padded = ' '.repeat(1000) + 'ab';
    expect(hasUsableTextLayer(padded, 1)).toBe(false);
  });

  it('never calls a document with no pages text', () => {
    expect(hasUsableTextLayer('plenty of text here', 0)).toBe(false);
  });
});
