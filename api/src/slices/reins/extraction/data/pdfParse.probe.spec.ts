import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { IPdfProbeResult } from '../domain/textExtraction.types';

/**
 * The probe runs in a child Bun process, on a real PDF. Two reasons: pdf.js
 * sets up its worker with a dynamic import that jest's module sandbox
 * refuses ("A dynamic import callback was invoked without
 * --experimental-vm-modules"), and Bun is what the API runs under in the
 * image. Stubbing the parser is what let a wrong call order (getInfo and
 * getText in parallel on one instance) ship: it failed on every PDF and no
 * test noticed.
 */
const PROBE_PATH = join(__dirname, 'pdfParse.probe.ts');
const RUNNER = `
  const { Logger } = await import('@nestjs/common');
  Logger.overrideLogger(false);
  const { PdfParseProbe } = await import(${JSON.stringify(PROBE_PATH)});
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const result = await new PdfParseProbe().probe(Buffer.concat(chunks));
  process.stdout.write(JSON.stringify(result));
`;

function isProbeResult(value: unknown): value is IPdfProbeResult {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return typeof o.pages === 'number' && typeof o.text === 'string';
}

function probeInBun(pdf: Buffer): IPdfProbeResult {
  const out = execFileSync('bun', ['-e', RUNNER], {
    cwd: join(__dirname, '..', '..', '..', '..', '..'),
    input: pdf,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const parsed: unknown = JSON.parse(out);
  if (!isProbeResult(parsed)) throw new Error(`runner printed ${out}`);
  return parsed;
}

function buildPdf(contentStream: string | null): Buffer {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    contentStream === null
      ? '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'
      : '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  ];
  if (contentStream !== null) {
    objects.push(
      `<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n${contentStream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    );
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('PdfParseProbe', () => {
  jest.setTimeout(60_000);

  it('reads the page count and the text layer of a real PDF', () => {
    const pdf = buildPdf('BT /F1 12 Tf 20 100 Td (Hello Mazda) Tj ET');

    const result = probeInBun(pdf);

    expect(result.pages).toBe(1);
    expect(result.text).toContain('Hello Mazda');
    expect(result.error).toBeUndefined();
  });

  it('reports a page with nothing on it as a page with no text, which is a scan', () => {
    const result = probeInBun(buildPdf(null));

    expect(result.pages).toBe(1);
    expect(result.text.trim()).toBe('');
  });

  it('reports a file that is not a PDF with the reason', () => {
    const result = probeInBun(Buffer.from('just some bytes'));

    expect(result.pages).toBe(0);
    expect(result.text).toBe('');
    expect(typeof result.error).toBe('string');
  });
});
