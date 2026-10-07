import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { markCitations, type CitationModes } from './citations';

// GitHub-flavored markdown with line breaks: keeps "foo\nbar" as two lines
// instead of joining (matches what users expect from chat output).
marked.setOptions({ gfm: true, breaks: true });

export interface IRenderMarkdownOptions {
  /**
   * What to do with `[^n]` citation markers (CLEAN-138). Absent means
   * `numbered`: a chip for each. See utils/citations.ts for the modes.
   */
  citations?: CitationModes;
}

/**
 * Parse markdown to safe HTML. Three-stage:
 *   0. citations     → `[^n]` outside code becomes a chip (or is removed)
 *   1. marked.parse  → raw HTML (no markdown left)
 *   2. DOMPurify     → strip <script>, on* attrs, javascript: URLs, etc.
 *
 * Returns the original input on error (so a malformed message still shows).
 * Browser-only — caller must guard against SSR (this app is `ssr: false`).
 */
export function renderMarkdown(
  input: string,
  options: IRenderMarkdownOptions = {},
): string {
  if (!input) return '';
  try {
    const withChips = markCitations(input, options.citations ?? 'numbered');
    const raw = marked.parse(withChips, { async: false }) as string;
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
        // Citation chips (CLEAN-138); `data-n` is the number they carry.
        'sup',
      ],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-n', 'role', 'tabindex', 'aria-hidden'],
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
