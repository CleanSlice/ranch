import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { markCitations, type CitationModes } from './citations'

marked.setOptions({ gfm: true, breaks: true })

export interface IRenderMarkdownOptions {
  /**
   * What to do with `[^n]` citation markers (CLEAN-138). Absent means
   * `numbered`: a chip for each. See utils/citations.ts for the modes.
   */
  citations?: CitationModes
}

/**
 * Parse markdown to safe HTML. Three-stage, then the admin's own wrapper:
 *   0. citations     → `[^n]` outside code becomes a chip (or is removed)
 *   1. marked.parse  → raw HTML (no markdown left)
 *   2. DOMPurify     → strip <script>, on* attrs, javascript: URLs, etc.
 *   3. wrapCodeBlocks → a "copy" button on every <pre>
 *
 * Returns the original input (escaped) on error so a malformed message still shows.
 */
export function renderMarkdown(input: string, options: IRenderMarkdownOptions = {}): string {
  if (!input) return ''
  try {
    const withChips = markCitations(input, options.citations ?? 'numbered')
    const raw = marked.parse(withChips, { async: false }) as string
    const clean = DOMPurify.sanitize(raw, {
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
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|\/)/i,
    })
    return wrapCodeBlocks(clean)
  } catch {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

const COPY_ICON_SVG =
  '<svg class="icon-copy" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'

const CHECK_ICON_SVG =
  '<svg class="icon-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

function wrapCodeBlocks(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return html
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('code-block')) return
    const wrapper = doc.createElement('div')
    wrapper.className = 'code-block'
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'code-copy'
    btn.setAttribute('data-action', 'copy')
    btn.setAttribute('aria-label', 'Copy code')
    btn.innerHTML = COPY_ICON_SVG + CHECK_ICON_SVG
    pre.parentNode?.insertBefore(wrapper, pre)
    wrapper.appendChild(btn)
    wrapper.appendChild(pre)
  })
  return root.innerHTML
}
