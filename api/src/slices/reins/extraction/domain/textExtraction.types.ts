/** What the probe learned about a PDF before any OCR decision. */
export interface IPdfProbeResult {
  /** Text the PDF's own text layer yields, whitespace and all. */
  text: string;
  /** Page count; 0 when the document could not be opened as a PDF. */
  pages: number;
  /** Why it could not be opened, when `pages` is 0. */
  error?: string;
}

/** Where a stored object lives, in the terms the OCR service reads it by. */
export interface IObjectLocation {
  bucket: string;
  key: string;
}

/** Everything the OCR gateway needs to read one document. */
export interface ITextExtractionInput extends IObjectLocation {
  /** The same bytes the probe read, so a one-page file needs no second download. */
  bytes: Buffer;
  pages: number;
}

export interface IExtractionOutcome {
  sourceId: string;
  /** `ready` produced text; `none` means the file has its own text; `failed` carries the reason. */
  state: 'ready' | 'none' | 'failed';
  reason: string | null;
}
