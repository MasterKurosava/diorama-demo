import { transition } from '@dioramajs/diorama'
import { app } from '../../docs/diorama.ts'

const SVG = 'http://www.w3.org/2000/svg'
// The model uses the library's defaults: 0.8 s, cubic in-out, takeover from 0.15 to 0.5.
const ease = (p: number) =>
  p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a || 1e-6), 0), 1)
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}
const SOURCE: Box = { x: 20, y: 120, w: 96, h: 72 }
const TARGET: Box = { x: 180, y: 20, w: 256, h: 144 }
const rect = (r: Box) => ({ x: r.x, y: r.y, width: r.w, height: r.h })

export default (example: HTMLElement) => {
  const svg = example.querySelector('.diagram')
  const box = example.querySelector('.box')
  const input = (name: string) =>
    example.querySelector<HTMLInputElement>(`.${name}`)
  const value = (name: string) => Number(input(name)?.value ?? 0)
  if (!svg || !box) return
  const style = getComputedStyle(example)
  const accent =
    style.getPropertyValue('--selection-bg').trim() || '#e2a18c'
  const muted =
    style.getPropertyValue('--text-muted').trim() || '#6d282b'
  const el = (
    tag: string,
    attrs: Record<string, string | number>,
    text?: string,
  ) => {
    const node = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs))
      node.setAttribute(k, String(v))
    if (text) node.textContent = text
    return node
  }

  function draw(): void {
    const p = value('progress')
    const from = value('from')
    const to = Math.max(value('to'), from)
    const e = ease(p)
    const share = smoothstep(from, to, p)
    for (const name of ['progress', 'duration', 'from', 'to']) {
      const out = example.querySelector(`.${name}-value`)
      if (out) out.textContent = value(name).toFixed(2)
    }
    const at: Box = {
      x: lerp(SOURCE.x, TARGET.x, e),
      y: lerp(SOURCE.y, TARGET.y, e),
      w: lerp(SOURCE.w, TARGET.w, e),
      h: lerp(SOURCE.h, TARGET.h, e),
    }
    // Both curves against progress, with the current progress marked.
    const chart: Box = { x: 460, y: 30, w: 120, h: 120 }
    const curve = (f: (q: number) => number) =>
      Array.from({ length: 41 }, (_, i) => {
        const q = i / 40
        return `${chart.x + q * chart.w},${chart.y + (1 - f(q)) * chart.h}`
      }).join(' ')
    const time = (p * value('duration')).toFixed(2)
    svg?.replaceChildren(
      el('rect', {
        ...rect(SOURCE),
        fill: 'none',
        stroke: muted,
        'stroke-dasharray': 4,
      }),
      el(
        'text',
        { x: SOURCE.x, y: SOURCE.y + SOURCE.h + 14, fill: muted },
        'source',
      ),
      el('rect', {
        ...rect(TARGET),
        fill: 'none',
        stroke: muted,
        'stroke-dasharray': 4,
      }),
      el(
        'text',
        { x: TARGET.x, y: TARGET.y - 6, fill: muted },
        'target',
      ),
      el('rect', { ...rect(at), fill: muted, opacity: 1 - share }),
      el('rect', { ...rect(at), fill: accent, opacity: share }),
      el(
        'text',
        { x: 20, y: 236, fill: muted },
        `t ${time} s   ease ${e.toFixed(2)}   cover ${Math.round(share * 100)} %`,
      ),
      el('rect', { ...rect(chart), fill: 'none', stroke: muted }),
      el('polyline', {
        points: curve(ease),
        fill: 'none',
        stroke: muted,
        'stroke-width': 2,
      }),
      el('polyline', {
        points: curve((q) => smoothstep(from, to, q)),
        fill: 'none',
        stroke: accent,
        'stroke-width': 2,
      }),
      el('line', {
        x1: chart.x + p * chart.w,
        y1: chart.y,
        x2: chart.x + p * chart.w,
        y2: chart.y + chart.h,
        stroke: muted,
        'stroke-dasharray': 3,
      }),
      el(
        'text',
        { x: chart.x, y: chart.y + chart.h + 14, fill: muted },
        'ease',
      ),
      el(
        'text',
        { x: chart.x + 44, y: chart.y + chart.h + 14, fill: muted },
        'cover share',
      ),
    )
  }

  const off: (() => void)[] = []
  const on = (
    target: Element | null,
    type: string,
    listener: () => void,
  ) => {
    target?.addEventListener(type, listener)
    off.push(() => target?.removeEventListener(type, listener))
  }
  for (const name of ['progress', 'duration', 'from', 'to'])
    on(input(name), 'input', draw)

  let raf = 0
  on(example.querySelector('.play'), 'click', () => {
    cancelAnimationFrame(raf)
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min((now - start) / 1000 / value('duration'), 1)
      const progress = input('progress')
      if (progress) progress.value = String(p)
      draw()
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  })
  off.push(() => cancelAnimationFrame(raf))

  // A real transition between two states of the box, with the duration of the slider.
  let cover = false
  on(example.querySelector('.real'), 'click', () => {
    cover = !cover
    const page = example.querySelector(
      cover ? '#model-cover' : '#model-thumb',
    )
    if (!(page instanceof HTMLTemplateElement)) return
    transition(
      app,
      () => box.replaceChildren(page.content.cloneNode(true)),
      {
        duration: value('duration'),
      },
    )
  })

  draw()
  return () => {
    for (const f of off) f()
  }
}
