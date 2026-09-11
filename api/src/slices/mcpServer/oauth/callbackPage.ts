/**
 * The tiny "return to the chat" page the OAuth callback answers with
 * (CLEAN-75). Kept as a pure function so the one thing that matters about it
 * — nothing interpolated can become markup — is unit-testable without Nest.
 *
 * The provider chooses the server name and, on failure, may echo arbitrary
 * text back through the error; both land in this page. Every value is
 * HTML-escaped, and the page ships a Content-Security-Policy that allows only
 * the one nonce-tagged inline script, so even a slip here has nowhere to run.
 */

export interface ICallbackPageInput {
  heading: string;
  sub: string;
  /** Per-response nonce; must match the `script-src` nonce in the CSP header. */
  nonce: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for insertion into HTML text or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** The CSP header for the page: no network, no other scripts, no frames. */
export function callbackPageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function renderCallbackPage(input: ICallbackPageInput): string {
  const nonce = escapeHtml(input.nonce);
  return (
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0;color:#111">` +
    `<div style="text-align:center;max-width:32rem;padding:1.5rem">` +
    `<h2 style="margin:.2rem 0">${escapeHtml(input.heading)}</h2>` +
    `<p style="color:#555">${escapeHtml(input.sub)}</p>` +
    `<script nonce="${nonce}">setTimeout(()=>window.close(),1500)</script></div></body>`
  );
}
