// The landscape's pointer over what can be clicked. Over a picture or a card a paper disc says
// what a click does; over a button or a link a ring closes around it; over the effect index only
// a dot, since the picture of the effect follows the pointer there. Elsewhere the system pointer
// stays. Mouse and pen only: touch screens never see it.
type Kind = 'label' | 'wrap' | 'dot'
interface Aim {
  readonly kind: Kind
  readonly element: Element
  readonly label: string
}

const TARGETS = 'a[href], button:not([disabled]), [data-cursor], [role="slider"]'
// Fields keep their own caret.
const NATIVE = 'textarea, input, select, [contenteditable]'
/** Pictures and cards that get the disc, with what the disc says. */
const PICTURES: readonly [selector: string, label: string][] = [
  ['.landing', 'Open'],
  ['.lantern-cell', 'Open'],
  ['.peak', 'Go'],
  ['.deck-handle', 'Drag'],
]
// How fast the disc catches up with the pointer, per 60 Hz frame.
const CATCH = 0.22
// Room between a ring and the element it closes around, px.
const PAD = 6

function aimAt(element: Element | null): Aim | undefined {
  if (!element || element.closest(NATIVE)) return undefined
  const target = element.closest(TARGETS)
  if (!target) return undefined
  const named = target.getAttribute('data-cursor')
  if (named === 'dot') return { kind: 'dot', element: target, label: '' }
  if (named) return { kind: 'label', element: target, label: named }
  for (const [selector, label] of PICTURES)
    if (target.matches(selector)) return { kind: 'label', element: target, label }
  return { kind: 'wrap', element: target, label: '' }
}

export function mountCursor(): void {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const root = document.documentElement
  let x = -100
  let y = -100
  let discX = -100
  let discY = -100
  let aim: Aim | undefined
  let frame = 0
  let last = 0

  const parts = () => {
    const el = document.querySelector<HTMLElement>('.cursor')
    return el
      ? {
          el,
          dot: el.querySelector<HTMLElement>('.cursor-dot'),
          ring: el.querySelector<HTMLElement>('.cursor-ring'),
          disc: el.querySelector<HTMLElement>('.cursor-disc'),
          text: el.querySelector<HTMLElement>('.cursor-text'),
        }
      : undefined
  }

  const draw = (now: number): void => {
    frame = 0
    const p = parts()
    if (!p) return
    const dt = last ? Math.min(4, (now - last) / (1000 / 60)) : 1
    last = now
    const k = reduced.matches ? 1 : 1 - (1 - CATCH) ** dt
    discX += (x - discX) * k
    discY += (y - discY) * k
    p.dot?.style.setProperty('translate', `${x}px ${y}px`)
    p.disc?.style.setProperty('translate', `${discX}px ${discY}px`)
    if (aim?.kind === 'wrap' && p.ring) {
      // Closes around the element, leaning a little towards the pointer.
      const box = aim.element.getBoundingClientRect()
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      const lean = reduced.matches ? 0 : 0.12
      const radius = getComputedStyle(aim.element).borderRadius
      p.ring.style.setProperty(
        'translate',
        `${box.left - PAD + (x - cx) * lean}px ${box.top - PAD + (y - cy) * lean}px`,
      )
      p.ring.style.width = `${box.width + PAD * 2}px`
      p.ring.style.height = `${box.height + PAD * 2}px`
      p.ring.style.borderRadius = radius === '0px' ? '10px' : `calc(${radius} + ${PAD}px)`
    }
    const settled = Math.abs(x - discX) < 0.3 && Math.abs(y - discY) < 0.3
    if (!settled || aim?.kind === 'wrap') frame = requestAnimationFrame(draw)
  }
  const wake = (): void => {
    if (!frame) {
      last = 0
      frame = requestAnimationFrame(draw)
    }
  }

  const choose = (next: Aim | undefined): void => {
    if (next?.element === aim?.element && next?.kind === aim?.kind) return
    const p = parts()
    aim = next
    if (!p) return
    p.el.dataset.kind = next?.kind ?? ''
    if (next?.kind === 'label' && p.text) p.text.textContent = next.label
    if (next) root.dataset.pointer = next.kind
    else delete root.dataset.pointer
    // The disc starts from the pointer, not from where it was last seen.
    if (next?.kind === 'label' && p.el.dataset.was !== 'label') {
      discX = x
      discY = y
    }
    p.el.dataset.was = next?.kind ?? ''
    wake()
  }

  addEventListener(
    'pointermove',
    (e) => {
      // The hand of the hints (ghost.ts) sends its own moves; this pointer stays the visitor's.
      if (e.pointerType === 'touch' || !e.isTrusted) return
      x = e.clientX
      y = e.clientY
      choose(aimAt(e.target as Element | null))
      wake()
    },
    { passive: true },
  )
  // Scrolling moves the page under a still pointer.
  addEventListener(
    'scroll',
    () => {
      if (x < 0) return
      choose(aimAt(document.elementFromPoint(x, y)))
      wake()
    },
    { passive: true },
  )
  root.addEventListener('pointerleave', (e) => e.isTrusted && choose(undefined))
  addEventListener('pointerdown', (e) => e.isTrusted && parts()?.el.classList.add('pressed'))
  addEventListener('pointerup', (e) => e.isTrusted && parts()?.el.classList.remove('pressed'))
  // A new page: what was under the pointer is gone.
  document.addEventListener('astro:after-swap', () => {
    aim = undefined
    choose(aimAt(document.elementFromPoint(x, y)))
  })
}
