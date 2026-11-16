// 04 Night. Shows aurora.frag with minimal highlighting.
import source from '../effects/aurora.frag?raw'

const TOKENS =
  /(\/\/.*)|\b(uniform|varying|void|return|const|if|else|for)\b|\b(float|vec2|vec3|vec4|int|bool|sampler2D)\b|\b(u[A-Z]\w*|vUv|gl_FragColor)\b|\b(\d+\.?\d*)\b/g
const KINDS = ['c', 'k', 't', 'u', 'n'] as const

const escapeHtml = (text: string): string =>
  text.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))

function paint(line: string): string {
  let html = ''
  let last = 0
  for (const match of line.matchAll(TOKENS)) {
    const index = match.index ?? 0
    const kind = KINDS[match.slice(1).findIndex((group) => group !== undefined)] ?? 'c'
    html += `${escapeHtml(line.slice(last, index))}<span class="${kind}">${escapeHtml(match[0])}</span>`
    last = index + match[0].length
  }
  return html + escapeHtml(line.slice(last))
}

export function mount(): () => void {
  const code = document.querySelector('.frag code')
  const count = document.querySelector('.frag-lines')
  const lines = source.replace(/\s+$/, '').split('\n')
  if (code)
    code.innerHTML = lines.map((line) => `<span class="ln">${paint(line) || ' '}</span>`).join('')
  if (count) count.textContent = `${lines.length} lines`
  return () => {}
}
