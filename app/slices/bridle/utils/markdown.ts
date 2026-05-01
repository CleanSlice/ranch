import DOMPurify from 'dompurify';
import { marked } from 'marked';

// GitHub-flavored markdown with line breaks: keeps "foo\nbar" as two lines
// instead of joining (matches what users expect from chat output).
marked.setOptions({ gfm: true, breaks: true });

/**
 * Parse markdown to safe HTML. Two-stage:
 *   1. marked.parse → raw HTML (no markdown left)
 *   2. DOMPurify    → strip <script>, on* attrs, javascript: URLs, etc.
 *
 * Returns the original input on error (so a malformed message still shows).
 * Browser-only — caller must guard against SSR (this app is `ssr: false`).
 */
export function renderMarkdown(input: string): string {
  if (!input) return '';
  try {
    const raw = marked.parse(input, { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: [
        'p', 'br', 'hr',
        'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark',
        'a',
        'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote',
        'code', 'pre',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'span', 'div',
      ],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
      // Block dangerous protocols even in href.
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|\/)/i,
    });
  } catch {
    // If marked / DOMPurify ever throw, fall back to plain text — escape
    // angle brackets so it still renders as text, not HTML.
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
