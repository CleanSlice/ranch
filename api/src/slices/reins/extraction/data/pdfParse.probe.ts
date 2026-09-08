import { Injectable } from '@nestjs/common';
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
  async probe(bytes: Buffer): Promise<IPdfProbeResult> {
    const parser = new PDFParse({ data: bytes });
    try {
      const [info, text] = await Promise.all([
        parser.getInfo(),
        parser.getText(),
      ]);
      return { text: text.text ?? '', pages: info.total };
    } catch {
      return { text: '', pages: 0 };
    } finally {
      await parser.destroy();
    }
  }
}
