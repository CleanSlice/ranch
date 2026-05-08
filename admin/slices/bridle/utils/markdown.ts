import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdown(input: string): string {
  if (!input) return ''
  try {
    const raw = marked.parse(input, { async: false }) as string
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
      ],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
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
