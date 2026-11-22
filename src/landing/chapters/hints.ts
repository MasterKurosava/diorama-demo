// Each chapter with something to touch shows it once with the hand of the effect previews
// (ghost.ts): it wipes the frost, strokes the wet paper, drags the edge of the deck, tries a
// swatch, plays a print. A hint waits until its chapter rests on screen and the visitor's own
// pointer is still and elsewhere; a visitor who has already touched the thing never sees it, and
// none plays twice in a session (sessionStorage "dio-hints", "*" for all of them).
import type { App } from '@dioramajs/diorama'
import { center, type Hand, type Point, play, playing, pointer, quiet, stop } from '../ghost'

interface Hint {
  /** What the visitor would touch. The hint plays once most of it is on screen. */
  readonly target: string
  /** How long the page has to rest first, ms. */
  readonly after?: number
  /** Anything else the hint waits for. */
  readonly ready?: () => boolean
  readonly run: (hand: Hand, target: HTMLElement) => Promise<void>
}

const viewport = (): DOMRect => new DOMRect(0, 0, innerWidth, innerHeight)
const box = (el: Element) => (): DOMRect => el.getBoundingClientRect()
const near = (aim: () => Point, dx = 70, dy = 90): Point => {
  const p = aim()
  return { x: p.x + dx, y: p.y + dy }
}

const HINTS: readonly Hint[] = [
  {
    // 02 The relief turns after the pointer; every summit is a link.
    target: '#map .topo',
    async run(hand, topo) {
      await hand.stroke(
        box(topo),
        [
          [0.18, 0.72],
          [0.42, 0.5],
          [0.7, 0.62],
        ],
        1500,
      )
      const peak = topo.querySelectorAll('.peak')[2]
      if (peak) {
        await hand.glide(center(peak, 0.5, 0.4), 700)
        await hand.wait(250)
        await hand.press()
      }
      await hand.wait(500)
    },
  },
  {
    // 03 Hover a card, then drag the edge: the 3D deck follows the CSS width.
    target: '#layout .deck',
    // After the deck has dealt itself into the grid.
    after: 2600,
    async run(hand, deck) {
      const card = deck.querySelectorAll('.card')[1]
      if (card) {
        await hand.glide(center(card), 900)
        await hand.wait(800)
      }
      const handle = document.querySelector('#layout .deck-handle')
      if (!handle) return
      const at = center(handle)
      await hand.glide(at, 800)
      hand.down()
      await hand.glide(() => ({ x: at().x - 110, y: at().y }), 900)
      await hand.wait(200)
      await hand.glide(() => ({ x: at().x + 0, y: at().y }), 800)
      hand.up()
      await hand.wait(300)
    },
  },
  {
    // 04 The window froze over: the pointer is warm and wipes it.
    target: '#night .night-hint .pill',
    after: 3600,
    ready: () => {
      const pane = document.querySelector('.frost-pane')
      return (
        pane?.getAttribute('data-dio-frost-cover') === '1' &&
        pane.matches('[data-dio-state="live"], [data-dio-state="drawn"]')
      )
    },
    async run(hand) {
      await hand.stroke(
        viewport,
        [
          [0.16, 0.44],
          [0.36, 0.56],
          [0.58, 0.42],
          [0.82, 0.54],
        ],
        2000,
      )
      await hand.wait(300)
    },
  },
  {
    // 05 The paper colour is a live param: try another swatch, then put the first one back.
    target: '#lantern .swatches',
    async run(hand, group) {
      const swatches = [...group.querySelectorAll<HTMLElement>('.swatch')]
      const was = swatches.find((s) => s.getAttribute('aria-pressed') === 'true') ?? swatches[0]
      const other = swatches[(swatches.indexOf(was as HTMLElement) + 2) % swatches.length]
      if (!was || !other) return
      await hand.glide(center(other), 800)
      await hand.press(true)
      await hand.wait(1400)
      await hand.glide(center(was), 600)
      await hand.press(true)
      await hand.wait(300)
    },
  },
  {
    // 06 Ink runs from the pointer into the wet paper.
    target: '#editor .ed-sheet img',
    async run(hand, img) {
      await hand.stroke(
        box(img),
        [
          [0.12, 0.34],
          [0.36, 0.48],
          [0.62, 0.38],
          [0.88, 0.52],
        ],
        1600,
      )
      await hand.wait(400)
    },
  },
  {
    // 07 A print plays under the pointer and opens its page.
    target: '#effects .cat-wall',
    async run(hand, wall) {
      const print = [...wall.querySelectorAll('.cat-print')].find(
        (p) => !p.classList.contains('live') && visible(p) > 0.9,
      )
      if (!print) return
      await hand.glide(center(print, 0.55, 0.45), 900)
      await hand.wait(1600)
      await hand.press()
      await hand.wait(500)
    },
  },
  {
    // 09 The install line copies on click.
    target: '#dawn .install',
    async run(hand, button) {
      await hand.glide(center(button, 0.82, 0.55), 800)
      await hand.wait(200)
      await hand.press()
      await hand.wait(500)
    },
  },
]

/** The hints a visitor has seen this session, so a return from a work page shows none again. */
const KEY = 'dio-hints'
function seen(): Set<string> {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as unknown
    if (list === '*') return new Set(HINTS.map((hint) => hint.target))
    return new Set(Array.isArray(list) ? list.map(String) : [])
  } catch {
    return new Set()
  }
}

/** Share of an element's box on screen, counting at most a screen's height of it. */
function visible(el: Element): number {
  const r = el.getBoundingClientRect()
  const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0))
  const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))
  if (!r.width || !r.height) return 0
  return (w / r.width) * (h / Math.min(r.height, innerHeight))
}

function inside(p: Point | undefined, el: Element, pad = 40): boolean {
  if (!p) return false
  const r = el.getBoundingClientRect()
  return p.x > r.left - pad && p.x < r.right + pad && p.y > r.top - pad && p.y < r.bottom + pad
}

export function mount(_app: App): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}
  const done = new Set<Hint>(HINTS.filter((hint) => seen().has(hint.target)))
  const tries = new Map<Hint, number>()
  const off = new AbortController()
  const { signal } = off
  let scrolled = performance.now()
  quiet()

  addEventListener('scroll', () => (scrolled = performance.now()), { passive: true, signal })
  // A visitor who touches the thing has found it.
  addEventListener(
    'pointerover',
    (e) => {
      if (!e.isTrusted) return
      for (const hint of HINTS) if ((e.target as Element | null)?.closest(hint.target)) finish(hint)
    },
    { passive: true, signal },
  )

  const finish = (hint: Hint): void => {
    if (done.has(hint)) return
    done.add(hint)
    try {
      sessionStorage.setItem(KEY, JSON.stringify([...done].map((h) => h.target)))
    } catch {}
  }

  const look = (): void => {
    if (done.size === HINTS.length) {
      clearInterval(timer)
      return
    }
    if (playing() || document.hidden || document.querySelector('.loader')) return
    if (quiet() < 1800) return
    const rest = performance.now() - scrolled
    for (const hint of HINTS) {
      if (done.has(hint) || rest < (hint.after ?? 1200)) continue
      const target = document.querySelector<HTMLElement>(hint.target)
      if (!target || visible(target) < 0.6 || inside(pointer(), target)) continue
      if (hint.ready && !hint.ready()) continue
      const start = near(center(target, 0.5, 0.5), 90, 110)
      void play((hand) => hint.run(hand, target), start).then((finished) => {
        const n = (tries.get(hint) ?? 0) + 1
        tries.set(hint, n)
        if (finished || n >= 2) finish(hint)
      })
      return
    }
  }
  const timer = setInterval(look, 300)
  return () => {
    clearInterval(timer)
    off.abort()
    stop()
  }
}
