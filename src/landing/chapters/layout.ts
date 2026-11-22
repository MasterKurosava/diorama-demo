// 03 Layout. The handle sets the deck's real CSS width, the buttons swap a layout class, and the
// panel shows the CSS in effect, read back from the stylesheets. The deck starts stacked and is
// dealt into the grid on first view with the same class switch.
import { paintMotif } from '../../effects/_deck-art'

const MODES = ['grid', 'row', 'stack', 'fan'] as const
type Mode = (typeof MODES)[number]

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const deg = (rad: number): string => `${Math.round(((rad * 180) / Math.PI) * 10) / 10}deg`
const px = (v: number): string => `${Math.round(v * 10) / 10}px`
/** Escapes a CSS value and keeps each `var(--x)` from wrapping. */
const value = (v: string): string =>
  esc(v).replace(/var\(--[\w-]+\)/g, '<span class="nb">$&</span>')

/** Stylesheet rules for a layout class, including matching media blocks. */
function rulesFor(m: Mode): CSSStyleRule[] {
  const found: CSSStyleRule[] = []
  const walk = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule && matchMedia(rule.conditionText).matches)
        walk(rule.cssRules)
      else if (rule instanceof CSSStyleRule && rule.selectorText.includes(`.is-${m}`))
        found.push(rule)
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules)
    } catch {
      // Cross-origin sheets throw on cssRules.
    }
  }
  return found
}

export function mount(): () => void {
  const deck = document.querySelector<HTMLElement>('.deck')
  const stage = document.querySelector<HTMLElement>('.stage')
  const handle = document.querySelector<HTMLElement>('.deck-handle')
  const ruler = document.querySelector<HTMLOutputElement>('.deck-ruler output')
  const code = document.querySelector<HTMLElement>('.css code')
  if (!deck || !stage || !handle || !ruler || !code) return () => {}
  const root = document.documentElement
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.modes button')]
  const cards = [...deck.querySelectorAll<HTMLElement>('.card')]
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const signal = new AbortController()
  const on = { signal: signal.signal }
  root.classList.toggle('no-hover', !matchMedia('(hover: hover)').matches)

  // Paint the DOM cards too. They show before the 3D draws and when it's off.
  for (const card of cards) {
    const canvas = card.querySelector('canvas')
    const g = canvas?.getContext('2d')
    if (canvas && g) paintMotif(g, card.dataset.motif ?? '', canvas.width, canvas.height)
  }

  // Space the handle needs on each side, px.
  const side = (): number => (window.innerWidth < 860 ? 26 : 44)
  const range = (): { min: number; max: number } => {
    const max = Math.max(200, stage.clientWidth - side() * 2)
    return { min: Math.min(max, window.innerWidth < 860 ? 200 : 500), max }
  }
  const fitted = (): number => Math.min(760, range().max)
  let width = fitted()
  // Set by the reader. Until then the deck takes the default width of its stage, which narrows
  // when the page scrollbar comes back after the loader.
  let sized = false
  let mode: Mode = 'stack'
  let touched = false

  function computed(m: Mode): string[] {
    if (m === 'grid' || m === 'row') {
      const tracks = getComputedStyle(deck as HTMLElement)
        .gridTemplateColumns.split(' ')
        .filter(Boolean)
      const same = tracks.every((t) => t === tracks[0])
      const columns = same
        ? `repeat(${tracks.length}, ${px(Number.parseFloat(tracks[0] ?? '0'))})`
        : tracks.join(' ')
      return [`grid-template-columns: <span class="live">${columns}</span>`]
    }
    return [0, cards.length - 1].map((i) => {
      const style = getComputedStyle(cards[i] as HTMLElement)
      const parts: string[] = []
      if (style.translate !== 'none') parts.push(`translate: ${style.translate}`)
      if (style.rotate !== 'none') parts.push(`rotate: ${style.rotate}`)
      if (style.transform !== 'none') {
        const m = new DOMMatrixReadOnly(style.transform)
        parts.push(`transform: rotate(${deg(Math.atan2(m.b, m.a))})`)
      }
      return `card ${i + 1}: <span class="live">${parts.join('; ') || 'none'}</span>`
    })
  }

  let shown: string[] = []
  let queued = 0
  function show(): void {
    if (!queued) queued = requestAnimationFrame(render)
  }
  function render(): void {
    cancelAnimationFrame(queued)
    queued = 0
    const lines = [
      `<span class="c">&lt;div</span> class=<span class="s">"deck is-${mode}"</span>`,
      `     data-dio=<span class="s">"deck"</span>`,
      `     style=<span class="s">"width: <span class="live">${width}px</span>"</span><span class="c">&gt;</span>`,
      '',
    ]
    for (const rule of rulesFor(mode)) {
      lines.push(`${esc(rule.selectorText)} {`)
      for (const decl of rule.style.cssText.split(';')) {
        const at = decl.indexOf(':')
        if (at < 0) continue
        const name = decl.slice(0, at).trim()
        const text = decl.slice(at + 1).trim()
        lines.push(`  <span class="p">${esc(name)}</span>: <span class="v">${value(text)}</span>;`)
      }
      lines.push('}')
    }
    lines.push('', `<span class="c">/* computed */</span>`, ...computed(mode))
    ;(code as HTMLElement).innerHTML = lines
      .map((line, i) => {
        const fresh = shown.length && shown[i] !== line ? ' fresh' : ''
        return `<span class="line${fresh}">${line || ' '}</span>`
      })
      .join('')
    shown = lines
  }

  function setWidth(next: number): void {
    const { min, max } = range()
    width = Math.round(Math.min(max, Math.max(min, next)))
    ;(deck as HTMLElement).style.width = `${width}px`
    handle?.setAttribute('aria-valuemin', String(min))
    handle?.setAttribute('aria-valuemax', String(max))
    handle?.setAttribute('aria-valuenow', String(width))
    handle?.setAttribute('aria-valuetext', `${width} pixels`)
    if (ruler) ruler.value = `${width}px`
    show()
  }

  function setMode(next: Mode): void {
    mode = next
    for (const m of MODES) deck?.classList.toggle(`is-${m}`, m === next)
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === next))
    show()
  }

  // The deck is centred, so it grows on both sides and the width changes by twice the drag.
  let drag: { x: number; width: number } | undefined
  handle.addEventListener(
    'pointerdown',
    (e) => {
      if (e.isTrusted) touched = true
      // The hint's hand is not a live pointer on every device, so capture may refuse it.
      try {
        handle.setPointerCapture(e.pointerId)
      } catch {}
      drag = { x: e.clientX, width }
      root.classList.add('resizing')
    },
    on,
  )
  handle.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return
      if (e.isTrusted) sized = true
      setWidth(drag.width + (e.clientX - drag.x) * 2)
    },
    on,
  )
  const drop = (): void => {
    drag = undefined
    root.classList.remove('resizing')
  }
  handle.addEventListener('pointerup', drop, on)
  handle.addEventListener('pointercancel', drop, on)
  handle.addEventListener(
    'keydown',
    (e) => {
      const { min, max } = range()
      const step = e.shiftKey ? 64 : 16
      const to: Record<string, number> = {
        ArrowLeft: width - step,
        ArrowDown: width - step,
        ArrowRight: width + step,
        ArrowUp: width + step,
        PageDown: width - 64,
        PageUp: width + 64,
        Home: min,
        End: max,
      }
      const next = to[e.key]
      if (next === undefined) return
      e.preventDefault()
      sized = true
      setWidth(next)
    },
    on,
  )
  const fit = new ResizeObserver(() => setWidth(sized ? width : fitted()))
  fit.observe(stage)
  for (const b of buttons) {
    b.addEventListener(
      'click',
      () => {
        touched = true
        setMode(b.dataset.mode as Mode)
      },
      on,
    )
  }

  // A width tween run by the page itself (WAAPI here, GSAP or Motion work the same). The 3D deck
  // follows every frame.
  const tween = document.querySelector<HTMLButtonElement>('.layout-tween')
  let tweening: Animation | undefined
  tween?.addEventListener(
    'click',
    () => {
      touched = true
      if (mode !== 'grid' && mode !== 'row') setMode('grid')
      tweening?.cancel()
      const { min, max } = range()
      const from = width
      const to = Math.abs(width - min) > Math.abs(width - max) ? min : max
      tweening = deck.animate(
        [{ width: `${from}px` }, { width: `${to}px` }, { width: `${from}px` }],
        {
          duration: reduced ? 1 : 2600,
          easing: 'cubic-bezier(0.6, 0, 0.3, 1)',
        },
      )
    },
    on,
  )

  setWidth(width)
  setMode(reduced ? 'grid' : 'stack')
  // Filled at once: Back puts the page back where it was against its height after mount.
  render()
  requestAnimationFrame(() => deck.classList.add('is-ready'))

  // Deal into the grid once the deck is in view and every card is drawn in 3D.
  let deal = 0
  const io = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting || touched || reduced) return
      io.disconnect()
      const since = performance.now()
      const wait = (): void => {
        if (touched) return
        const drawn = cards.every((c) => c.getAttribute('data-dio-state') === 'drawn')
        if (drawn || performance.now() - since > 8000)
          deal = window.setTimeout(() => !touched && setMode('grid'), 650)
        else requestAnimationFrame(wait)
      }
      wait()
    },
    { threshold: 0.45 },
  )
  io.observe(stage)

  return () => {
    signal.abort()
    io.disconnect()
    fit.disconnect()
    cancelAnimationFrame(queued)
    clearTimeout(deal)
    root.classList.remove('resizing')
  }
}
