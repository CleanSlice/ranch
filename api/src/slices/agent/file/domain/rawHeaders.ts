import type { FileKind } from './fileKind';

/**
 * Response headers for `GET /agents/:id/files/raw` (CLEAN-112).
 *
 * A workspace may hold `.html`, `.js` or `.svg` an agent wrote. Served from
 * the API origin they must never run as active content: every text kind goes
 * out as plain text, binary kinds keep their stored type except anything a
 * browser would render as a document, and the response is sandboxed by CSP.
 */
export function rawResponseHeaders(
  path: string,
  kind: FileKind,
  storedContentType: string,
  size: number,
): Record<string, string> {
  const filename = path.slice(path.lastIndexOf('/') + 1);
  const safeName = filename.replace(/["\r\n]/g, '_') || 'file';
  const headers: Record<string, string> = {};

  if (kind === 'text') {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    headers['Content-Disposition'] = `inline; filename="${safeName}"`;
  } else {
    headers['Content-Type'] = isActiveContentType(storedContentType)
      ? 'application/octet-stream'
      : storedContentType;
    headers['Content-Disposition'] = `attachment; filename="${safeName}"`;
  }

  headers['Content-Length'] = String(size);
  headers['Cache-Control'] = 'private, no-store';
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
  headers['Referrer-Policy'] = 'no-referrer';
  return headers;
}

/** Types a browser could render as a document or execute. */
export function isActiveContentType(contentType: string): boolean {
  const t = contentType.toLowerCase();
  return (
    t.includes('svg') ||
    t.includes('html') ||
    t.includes('xml') ||
    t.includes('javascript') ||
    t.includes('ecmascript')
  );
}
