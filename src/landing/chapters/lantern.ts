// 05 Lantern. The swatches write data-dio-tint, a live param, and the dye travels with the lantern
// to its page. The loading readout follows app.assets.progress.
import { type App, ready } from '@dioramajs/diorama'

// Site palette plus an indigo for the night page.
const TINTS = [
  { name: 'Cream', css: '#f6dcc0' },
  { name: 'Peach', css: '#e2a18c' },
  { name: 'Rose', css: '#c98a80' },
  { name: 'Wine', css: '#86393b' },
  { name: 'Indigo', css: '#5b63b7' },
] as const

let tint = '#e2a18c'

/** Current dye. main.ts stamps it on the incoming page before the effects see its markup. */
export const currentTint = (): string => tint

function dye(css: string): void {
  tint = css
  for (const el of document.querySelectorAll('[data-dio~="lantern"]'))
    el.setAttribute('data-dio-tint', css)
  for (const b of document.querySelectorAll<HTMLElement>('.swatch')) {
    b.setAttribute('aria-pressed', String(b.dataset.tint === css))
  }
  for (const v of document.querySelectorAll('.tint-value')) v.textContent = css
}

export function mount(app: App): () => void {
  const groups = document.querySelectorAll('.swatches')
  if (!groups.length) return () => {}
  const done = new AbortController()
  for (const group of groups) {
    group.replaceChildren(
      ...TINTS.map(({ name, css }) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'swatch'
        b.title = name
        b.dataset.tint = css
        b.style.setProperty('--c', css)
        b.setAttribute('aria-label', name)
        b.addEventListener('click', () => dye(css), { signal: done.signal })
        return b
      }),
    )
  }
  dye(tint)

  const pct = document.querySelector('.lantern-load .pct')
  const bar = document.querySelector<HTMLElement>('.lantern-load .bar')
  let shown = 0
  let target = 0
  let frame = 0
  const draw = (): void => {
    shown += (target - shown) * 0.14
    if (Math.abs(target - shown) < 0.4) shown = target
    if (pct) pct.textContent = String(Math.round(shown))
    bar?.style.setProperty('--p', String(shown / 100))
    if (shown !== target && !done.signal.aborted) frame = requestAnimationFrame(draw)
  }
  void ready(app)
    .then(() => {
      if (done.signal.aborted) return
      const off = app.assets.progress.subscribe((p) => {
        target = p * 100
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(draw)
      })
      done.signal.addEventListener('abort', off)
    })
    .catch(() => {})
  return () => {
    done.abort()
    cancelAnimationFrame(frame)
  }
}
