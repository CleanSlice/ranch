import { Injectable } from '@nestjs/common';
import {
  ITextractDocument,
  TextractRepository,
  TEXTRACT_SYNC_MAX_BYTES,
} from '#/aws/textract';
import { ITextExtractionGateway } from '../domain/textExtraction.gateway';
import { ITextExtractionInput } from '../domain/textExtraction.types';

/**
 * The one place the Textract repository meets this slice's domain. Picks
 * the cheaper of Textract's two shapes and renders the result as the text
 * LightRAG will chunk: one line per detected line, pages separated by a
 * marker so a chunk keeps its page.
 */
@Injectable()
export class TextractExtractionGateway extends ITextExtractionGateway {
  constructor(private readonly textract: TextractRepository) {
    super();
  }

  async extractText(input: ITextExtractionInput): Promise<string> {
    const document = await this.detect(input);
    // The page markers alone would pass a plain emptiness check and index a
    // document that says nothing.
    if (!hasAnyLine(document)) {
      throw new Error('OCR found no text in the document');
    }
    return renderDocument(document);
  }

  /**
   * Synchronous detection is a single round-trip but takes exactly one page
   * and at most 10 MB; everything else goes through a job that Textract reads
   * from S3 itself.
   */
  private async detect(input: ITextExtractionInput): Promise<ITextractDocument> {
    const location = { bucket: input.bucket, key: input.key };
    if (input.pages !== 1 || input.bytes.length > TEXTRACT_SYNC_MAX_BYTES) {
      return this.textract.detectDocument(location);
    }
    try {
      return await this.textract.detectSinglePage(input.bytes);
    } catch (err) {
      // The synchronous call is documented image-first; a PDF it will not
      // take inline it still reads happily from the bucket.
      if (isUnsupportedDocument(err)) {
        return this.textract.detectDocument(location);
      }
      throw err;
    }
  }
}

function hasAnyLine(document: ITextractDocument): boolean {
  return document.pages.some((page) =>
    page.lines.some((line) => line.trim().length > 0),
  );
}

function isUnsupportedDocument(err: unknown): boolean {
  return err instanceof Error && err.name === 'UnsupportedDocumentException';
}

export function renderDocument(document: ITextractDocument): string {
  return document.pages
    .map((page) => `--- page ${page.page} ---\n${page.lines.join('\n')}`)
    .join('\n\n');
}
