import {
  IObjectLocation,
  IPdfProbeResult,
  ITextExtractionInput,
} from './textExtraction.types';

/**
 * Reads a PDF's own text layer. Separate from OCR so the decision "does this
 * file need OCR at all" costs nothing and needs no network.
 */
export abstract class IPdfTextProbe {
  abstract probe(bytes: Buffer): Promise<IPdfProbeResult>;
}

/**
 * Turns a document with no text layer into text. Knows nothing about
 * sources or rows: it is handed an object and returns a string, or throws
 * with a reason a person can read on the row.
 */
export abstract class ITextExtractionGateway {
  abstract extractText(input: ITextExtractionInput): Promise<string>;
}

/**
 * The store behind a source's `url`: where the PDF is read from and where
 * its recognised text is written. Keeps the bucket SDK out of the domain the
 * way the source gateway keeps Prisma out of it.
 */
export abstract class ISourceObjectStore {
  /** The bucket and key a stored-object URI points at. */
  abstract locate(uri: string): IObjectLocation;
  abstract read(uri: string): Promise<Buffer>;
  /** Writes UTF-8 text at the URI, creating or replacing the object. */
  abstract writeText(uri: string, text: string): Promise<void>;
}
