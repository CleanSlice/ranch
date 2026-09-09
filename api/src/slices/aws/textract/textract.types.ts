/**
 * The repository's own shapes. Nothing here comes from any slice's domain:
 * a repository is a self-contained wrapper, and the gateway that uses it
 * adapts these into domain types.
 */

export interface ITextractLocation {
  bucket: string;
  key: string;
}

export interface ITextractPage {
  /** 1-based, as Textract numbers them. */
  page: number;
  /** LINE blocks in the order Textract returned them (reading order). */
  lines: string[];
}

export interface ITextractDocument {
  pages: ITextractPage[];
}

export interface ITextractDetectOptions {
  /** How often to ask about an asynchronous job. */
  pollIntervalMs?: number;
  /** Give up on an asynchronous job after this long. */
  timeoutMs?: number;
}
