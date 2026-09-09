import { Injectable, Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { IPdfTextProbe } from '../domain/textExtraction.gateway';
import { IPdfProbeResult } from '../domain/textExtraction.types';

/**
 * The same package and the same call upstream uses for chat attachments
 * (`bridle/domain/documentText.extractor.ts`), so the two repositories keep
 * one PDF library between them.
 *
 * A file that is not a PDF at all comes back as zero pages and no text; the
 * caller treats that as "cannot be probed", not as "needs OCR".
 */
@Injectable()
export class PdfParseProbe extends IPdfTextProbe {
  private readonly logger = new Logger(PdfParseProbe.name);

  async probe(bytes: Buffer): Promise<IPdfProbeResult> {
    const parser = new PDFParse({ data: bytes });
    try {
      // One call at a time. Running getInfo and getText concurrently on the
      // same parser fails inside pdf.js's worker transfer ("Cannot transfer
      // object of unsupported type" on Node, "The object can not be cloned"
      // on Bun), and it fails for every PDF, not just odd ones.
      const info = await parser.getInfo();
      // pdf-parse joins pages with "-- N of M --" by default; that is not
      // document text and must not count towards the per-page threshold.
      const text = await parser.getText({ pageJoiner: '\n' });
      return { text: text.text ?? '', pages: info.total };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`pdf probe failed: ${message}`);
      return { text: '', pages: 0, error: message };
    } finally {
      await parser.destroy();
    }
  }
}
