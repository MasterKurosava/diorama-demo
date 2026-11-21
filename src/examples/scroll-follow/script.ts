import { app } from '../../docs/diorama.ts'

const SVG = 'http://www.w3.org/2000/svg'
const OFF = 'canvas[data-dio-canvas] { animation: none !important }'

// The diagram is a model of one moment between two frames: the compositor has scrolled the page
// by the slider's amount and the main thread has not drawn yet. The switches act on this page
// for real: a stylesheet that removes the canvas animation turns followScroll off (the library
// checks for it every frame), and the stall is a system that blocks each frame for 50 ms.
export default (example: HTMLElement) => {
  const svg = example.querySelector('.diagram')
  const ahead = example.querySelector<HTMLInputElement>('.ahead')
  const aheadValue = example.querySelector('.ahead-value')
  const follow = example.querySelector<HTMLInputElement>('.follow')
  const stall = example.querySelector<HTMLInputElement>('.stall')
  if (!svg) return
  const off: (() => void)[] = []
  const on = (
    el: Element | null,
    type: string,
    listener: () => void,
  ) => {
    el?.addEventListener(type, listener)
    off.push(() => el?.removeEventListener(type, listener))
  }

  const sheet = document.createElement('style')
  sheet.textContent = OFF
  on(follow, 'change', () => {
    if (follow?.checked) sheet.remove()
    else document.head.append(sheet)
    // The library re-reads the switch in its next frame.
    app.invalidate()
    draw()
  })
  off.push(() => {
    sheet.remove()
    app.invalidate()
  })

  let busy: (() => void) | undefined
  on(stall, 'change', () => {
    busy?.()
    busy = undefined
    if (stall?.checked)
      busy = app.system('render', () => {
        const end = performance.now() + 50
        while (performance.now() < end);
      })
  })
  off.push(() => busy?.())

  on(example.querySelector('.up'), 'click', () =>
    window.scrollBy({ top: -400, behavior: 'smooth' }),
  )
  on(example.querySelector('.down'), 'click', () =>
    window.scrollBy({ top: 400, behavior: 'smooth' }),
  )
  on(ahead, 'input', () => draw())

  const style = getComputedStyle(example)
  const accent = style.getPropertyValue('--link').trim() || '#86393b'
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
    if (!svg) return
    const s = Number(ahead?.value ?? 0)
    if (aheadValue) aheadValue.textContent = String(s)
    const following = follow?.checked !== false
    // 300 units are a 1000 px viewport; the box sat at 450 px when the last frame drew.
    const k = 0.3
    const drawnAt = 135
    const dom = drawnAt - s * k
    const plane = following ? dom : drawnAt
    const h = 120
    svg.replaceChildren(
      el('rect', {
        x: 10,
        y: 0,
        width: 280,
        height: 300,
        fill: 'none',
        stroke: muted,
        'stroke-dasharray': 4,
      }),
      el('text', { x: 16, y: 16, fill: muted }, 'viewport'),
      el('rect', {
        x: 40,
        y: dom,
        width: 90,
        height: h,
        fill: 'none',
        stroke: muted,
        'stroke-width': 2,
      }),
      el('text', { x: 40, y: dom - 6, fill: muted }, 'DOM box'),
      el('rect', {
        x: 170,
        y: plane,
        width: 90,
        height: h,
        fill: accent,
        opacity: 0.3,
        stroke: accent,
      }),
      el('text', { x: 170, y: plane - 6, fill: accent }, 'plane'),
      ...(following && s > 0
        ? [
            el('line', {
              x1: 270,
              y1: drawnAt,
              x2: 270,
              y2: plane,
              stroke: accent,
              'stroke-width': 2,
            }),
            el('line', {
              x1: 264,
              y1: drawnAt,
              x2: 276,
              y2: drawnAt,
              stroke: accent,
              'stroke-width': 2,
            }),
            el(
              'text',
              { x: 170, y: plane + h + 16, fill: accent },
              'moved on the compositor',
            ),
          ]
        : []),
      el(
        'text',
        { x: 14, y: 330, fill: muted },
        `plane behind its box: ${following ? 0 : s} px`,
      ),
      el(
        'text',
        { x: 14, y: 350, fill: muted },
        `compositor offset of the canvas: ${following ? s : 0} px`,
      ),
    )
  }
  draw()
  return () => {
    for (const f of off) f()
  }
}
