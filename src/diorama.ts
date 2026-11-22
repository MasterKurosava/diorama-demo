// The one Diorama app of the site and the page lifecycle under Astro's ClientRouter. Page scripts
// import from here and never call start() themselves: Astro runs component scripts in document
// order, and whichever called start() first would decide the options.
import { ready, start, transition } from '@dioramajs/diorama'
import Lenis from 'lenis'
import { small } from './small/small'

/** How the current page was reached. */
export interface Arrival {
  readonly type: 'load' | 'push' | 'replace' | 'traverse'
  /** The page left, absent on load. */
  readonly from?: URL
}

type Mount = (element: Element, arrival: Arrival) => (() => void) | undefined

const root = document.documentElement
// Lenis smooths wheel steps that would make the scroll-driven hero and dawn jump.
const LENIS = { allowNestedScroll: true }

// The landscape's loader is plain CSS, so its sun starts rising on the first frame. Building the
// scene can block drawing for a moment, so start it once the rise has slowed and the hitch is
// hard to see.
if (document.querySelector('.loader') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  await new Promise((done) => setTimeout(done, Math.max(0, 900 - performance.now())))
}

// What the page's own markup puts on <html>. Everything else there was set by scripts and is
// carried to the next page, which Astro would otherwise give a fresh <html>.
let markup = attributes(root)

let lenis: Lenis | undefined = new Lenis(LENIS)
// Under the note for small screens the engine never boots.
export const app = start({ lenis, enabled: small() ? false : 'auto' })

/**
 * The smooth scroll of the current page. Pages ask for it with `data-lenis` on <html>; on the
 * others the page scrolls natively.
 */
export const smoothScroll = (): Lenis | undefined => lenis

function useLenis(): void {
  const wanted = root.hasAttribute('data-lenis')
  if (wanted && !lenis) {
    lenis = new Lenis(LENIS)
    app.lenis?.use(lenis)
  } else if (!wanted && lenis) {
    lenis.destroy()
    lenis = undefined
  }
}
// The app takes the first Lenis while it starts, so a page without it lets go only afterwards.
if (!root.hasAttribute('data-lenis')) void ready(app).then(useLenis, () => {})

const pages: { selector: string; mount: Mount; offs: (() => void)[] }[] = []
let arrival: Arrival = { type: 'load' }

/**
 * Runs `mount` for every element that matches `selector` on each page, at once for the current
 * one. The cleanups run inside the page swap, after the flights have taken their pictures.
 */
export function onPage(selector: string, mount: Mount): void {
  const page: (typeof pages)[number] = { selector, mount, offs: [] }
  pages.push(page)
  enter(page)
}

function enter(page: (typeof pages)[number]): void {
  for (const element of document.querySelectorAll(page.selector)) {
    const off = page.mount(element, arrival)
    if (off) page.offs.push(off)
  }
}

const inOut = (t: number): number => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2)

document.addEventListener('astro:before-preparation', (event) => {
  const load = event.loader
  event.loader = async () => {
    await load()
    // A failed load keeps the current document there: nothing to preload.
    if (event.defaultPrevented || event.newDocument === document) return
    void app.assets?.preload(event.newDocument, { base: event.to })
  }
})

document.addEventListener('astro:before-swap', (event) => {
  const next = event.newDocument.documentElement
  const nextMarkup = attributes(next)
  const swap = event.swap
  event.swap = () =>
    void transition(
      app,
      () => {
        for (const page of pages) for (const off of page.offs.splice(0)) off()
        carry(next)
        markup = nextMarkup
        swap()
      },
      // Paired pictures fly for 1.25 s. Unpaired ones leave or enter their own way (the burn on
      // the lantern page) or fade.
      {
        url: event.to,
        viewTransition: event.viewTransition,
        duration: 1.25,
        ease: inOut,
        leave: 0.9,
        enter: 0.7,
      },
    )
  arrival = { type: event.navigationType, from: event.from }
})

document.addEventListener('astro:after-swap', () => {
  useLenis()
  // Astro has scrolled natively. Stopping Lenis ends a smooth scroll of the page that left and
  // starts it again from where Astro put the new one. Never scrollTo(0) here, which would undo
  // the position Astro restores on Back.
  if (lenis) {
    lenis.resize()
    lenis.stop()
    lenis.start()
  }
  for (const page of pages) enter(page)
})

function attributes(el: Element): Map<string, string> {
  return new Map([...el.attributes].map((a) => [a.name, a.value]))
}

/** Copies what scripts set on <html> onto the next page's, unless its markup sets the same. */
function carry(next: HTMLElement): void {
  const own = new Set(markup.get('class')?.split(/\s+/))
  for (const name of root.classList) if (!own.has(name)) next.classList.add(name)
  for (const { name, value } of root.attributes) {
    if (name === 'class' || name.startsWith('data-astro-')) continue
    if (!markup.has(name) && !next.hasAttribute(name)) next.setAttribute(name, value)
  }
}
