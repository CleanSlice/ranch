import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdown(input: string): string {
  if (!input) return ''
  try {
    const raw = marked.parse(input, { async: false }) as string
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
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|\/)/i,
    })
  } catch {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}
