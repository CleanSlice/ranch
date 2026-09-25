/**
 * The tiny "return to the chat" page the OAuth callback answers with
 * (CLEAN-75). Kept as a pure function so the one thing that matters about it
 * — nothing interpolated can become markup — is unit-testable without Nest.
 *
 * The provider chooses the server name and, on failure, may echo arbitrary
 * text back through the error; both land in this page. Every value is
 * HTML-escaped, and the page ships a Content-Security-Policy that allows only
 * the one nonce-tagged inline script, so even a slip here has nowhere to run.
 *
 * With a `returnTo` the page takes the person back to the chat itself
 * (CLEAN-120): a meta refresh after five seconds, which works with scripts
 * blocked, a countdown for those who can run them, and a button for a browser
 * that refuses redirects altogether. Without one it only says where to go —
 * the person got here from a widget or a share page whose address the API
 * does not know.
 */

export interface ICallbackPageInput {
  heading: string;
  sub: string;
  /** Per-response nonce; must match the `script-src` nonce in the CSP header. */
  nonce: string;
  /** Where the chat is, when the caller told us; already origin-checked. */
  returnTo?: string | null;
}

/** How long the page waits before going back on its own. */
export const RETURN_DELAY_SECONDS = 5;

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

/**
 * The CSP header for the page: no network, no other scripts, no frames. A
 * meta refresh is navigation, not a fetch, so `default-src 'none'` does not
 * block it.
 */
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
  const head =
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    (input.returnTo
      ? `<meta http-equiv="refresh" content="${RETURN_DELAY_SECONDS};url=${escapeHtml(input.returnTo)}">`
      : '');
  const body =
    `<body style="font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0;color:#111">` +
    `<div style="text-align:center;max-width:32rem;padding:1.5rem">` +
    `<h2 style="margin:.2rem 0">${escapeHtml(input.heading)}</h2>` +
    `<p style="color:#555">${escapeHtml(input.sub)}</p>`;
  if (!input.returnTo) {
    return (
      head +
      body +
      `<script nonce="${nonce}">setTimeout(()=>window.close(),1500)</script></div></body>`
    );
  }
  const href = escapeHtml(input.returnTo);
  // A JS string literal inside <script>: JSON.stringify quotes it, and `<`
  // is written as < so a "</script>" in the value could not end the
  // block — belt and braces on top of the origin check the service did.
  const jsHref = JSON.stringify(input.returnTo).replace(/</g, '\\u003c');
  return (
    head +
    body +
    `<p style="color:#555">Returning to the chat in <span id="s">${RETURN_DELAY_SECONDS}</span> seconds…</p>` +
    `<p><a href="${href}" style="display:inline-block;padding:.55rem 1.1rem;border-radius:.5rem;background:#111;color:#fff;text-decoration:none;font-weight:600">Back to chat</a></p>` +
    `<script nonce="${nonce}">(function(){var n=${RETURN_DELAY_SECONDS},e=document.getElementById("s");var t=setInterval(function(){n--;if(e)e.textContent=String(n);if(n<=0){clearInterval(t);location.replace(${jsHref})}},1000)})()</script>` +
    `</div></body>`
  );
}
