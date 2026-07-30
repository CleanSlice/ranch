// Error-shape normalization for @kubernetes/client-node 1.x. Its ApiException
// carries the k8s Status resource in `body` — but depending on the endpoint
// the SDK delivers it either parsed (object) or as the raw JSON string
// (readNamespacedPodLog does the latter). Reading `err.body.message` as an
// object property therefore silently misses the string case, and callers fall
// back to `err.message` — a multi-line "HTTP-Code: 400\n…Body:…Headers:…"
// dump that must never reach logs or the UI.

// The k8s Status `message` from an API error, whatever shape the body has.
export function kubeErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const body = (err as { body?: unknown }).body;
  if (body && typeof body === 'object') {
    const msg = (body as { message?: unknown }).message;
    return typeof msg === 'string' ? msg : null;
  }
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { message?: unknown };
      return typeof parsed.message === 'string' ? parsed.message : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function kubeErrorCode(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { statusCode?: number; code?: number };
  return e.statusCode ?? e.code ?? null;
}

// Single-line human-readable form for logs and API responses.
export function formatKubeError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const code = kubeErrorCode(err);
  const message = kubeErrorMessage(err);
  if (message) return `${code ?? ''} ${message}`.trim();
  const raw = (err as { message?: string }).message;
  if (raw) return raw.split('\n')[0];
  return JSON.stringify(err).slice(0, 200);
}
