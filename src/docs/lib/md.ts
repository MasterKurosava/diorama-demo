// Small Markdown for TSDoc text: paragraphs, lists, fenced and indented code, inline code, links,
// emphasis. Inline code goes through the same linker as the MDX pages.

export type Block =
  | { readonly type: 'p'; readonly html: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'code'; readonly lang: string; readonly code: string }

const escapeHtml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export function inline(text: string, link?: (code: string) => string | undefined): string {
  const parts = text.split(/(`[^`]+`)/)
  return parts
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        const code = part.slice(1, -1)
        const href = link?.(code)
        const tag = `<code>${escapeHtml(code)}</code>`
        return href ? `<a class="code-link" href="${escapeHtml(href)}">${tag}</a>` : tag
      }
      return escapeHtml(part)
        .replace(
          /\[([^\]]+)\]\(([^)\s]+)\)/g,
          (_, t: string, u: string) => `<a href="${u}">${t}</a>`,
        )
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>')
    })
    .join('')
}

export function blocks(md: string, link?: (code: string) => string | undefined): Block[] {
  const out: Block[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      i++
      continue
    }
    const fence = /^\s*```(\w*)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) body.push(lines[i++] ?? '')
      i++
      out.push({ type: 'code', lang: fence[1] || 'ts', code: body.join('\n') })
      continue
    }
    if (/^( {4}|\t)/.test(line)) {
      const body: string[] = []
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i] ?? '') || !(lines[i] ?? '').trim())) {
        body.push((lines[i] ?? '').replace(/^( {4}|\t)/, ''))
        i++
      }
      out.push({ type: 'code', lang: 'ts', code: body.join('\n').trimEnd() })
      continue
    }
    const item = /^\s*([-*]|\d+\.)\s+/.exec(line)
    if (item) {
      const ordered = /\d/.test(item[1] ?? '')
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? '')) {
        let text = (lines[i] ?? '').replace(/^\s*([-*]|\d+\.)\s+/, '')
        i++
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i] ?? '') &&
          !/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? '')
        ) {
          text += ` ${(lines[i] ?? '').trim()}`
          i++
        }
        items.push(inline(text, link))
      }
      out.push({ type: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^\s*```/.test(lines[i] ?? '') &&
      !/^( {4}|\t)/.test(lines[i] ?? '')
    ) {
      para.push((lines[i] ?? '').trim())
      i++
    }
    out.push({ type: 'p', html: inline(para.join(' '), link) })
  }
  return out
}

/** First sentence of a summary, for leads and tables. */
export function firstSentence(md: string): string {
  const para =
    md
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''
  const m = /^(.+?[.!?])(\s|$)/.exec(para)
  return m?.[1] ?? para
}
