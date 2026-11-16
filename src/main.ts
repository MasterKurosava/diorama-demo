import { ready, start, transition } from 'diorama'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { aimAt, arrived, clamp, DEPTH, hero, LANDED, nearFade, seen, smooth } from './effects/_hero'
import './style.css'
import { currentTint, mountChapters, mountLantern, skyAt } from './chapters'
import { warmAhead } from './warm'

const root = document.documentElement
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
hero.reduced = reduced.matches
reduced.addEventListener('change', () => {
  hero.reduced = reduced.matches
})

// The loader is plain CSS, so its sun starts rising on the first frame. Building the scene can
// block drawing for a moment, so start it once the rise has slowed and the hitch is hard to see.
const loader = document.querySelector<HTMLElement>('.loader')
if (loader && !hero.reduced) {
  await new Promise((done) => setTimeout(done, Math.max(0, 900 - performance.now())))
}

// Lenis smooths wheel steps that would make the scroll-driven hero and dawn jump.
const lenis = new Lenis({ allowNestedScroll: true })
export const app = start({ lenis })

const look = (e: PointerEvent): void => {
  hero.pointer.x = e.clientX / window.innerWidth - 0.5
  hero.pointer.y = e.clientY / window.innerHeight - 0.5
  hero.pointer.moved = true
}
addEventListener('pointermove', look, { passive: true })
addEventListener('pointerdown', look, { passive: true })

// data-dio-state values that count as done for the first screen.
const SETTLED = new Set(['drawn', 'live', 'failed', 'off'])

if (loader) dawn(loader)
else hero.start = performance.now()

function dawn(el: HTMLElement): void {
  const since = performance.now()
  let settled = false
  ready(app)
    .then(async () => {
      app.assets.track(document.fonts.ready)
      await app.assets.ready()
    })
    .catch(() => {})
    .finally(() => {
      settled = true
    })
  const wait = (): void => {
    const pieces = document.querySelectorAll('.hero-pin[data-dio], .hero-pin [data-dio]')
    const drawn = [...pieces].every((e) => SETTLED.has(e.getAttribute('data-dio-state') ?? ''))
    // No GPU or something failed: give up after 12 s and show the plain HTML.
    if ((settled && drawn) || performance.now() - since > 12000) leave(el)
    else requestAnimationFrame(wait)
  }
  requestAnimationFrame(wait)
}

function leave(el: HTMLElement): void {
  el.classList.add('out')
  hero.start = performance.now() + 350
  setTimeout(() => el.remove(), 2000)
  // Drop the CSS dusk once the scene's sky covers it.
  setTimeout(() => root.classList.add('gl'), 2400)
}

// Scrolling the hero flies the eye into the scene. The text goes first, each piece fades just
// before the eye reaches it, and the photo lands in the final frame where the card takes over.
function mountHero(): () => void {
  const room = document.querySelector<HTMLElement>('.hero')
  const words = document.querySelector<HTMLElement>('.hero-words')
  const title = document.querySelector<HTMLElement>('.hero-title')
  const photo = document.querySelector<HTMLElement>('.piece-photo')
  const portrait = document.querySelector<HTMLElement>('.piece-portrait')
  const metal = document.querySelector<HTMLElement>('.piece-metal')
  const chapter = document.querySelector<HTMLElement>('.chapter')
  const pin = document.querySelector<HTMLElement>('.hero-pin')
  const shot = photo?.querySelector<HTMLElement>('[data-dio]')
  const landing = document.querySelector<HTMLElement>('.landing')
  if (!room) return () => {}
  let frame = 0
  const follow = (): void => {
    cancelAnimationFrame(frame)
    if (pin && shot && landing)
      aimAt(
        shot.getBoundingClientRect(),
        landing.getBoundingClientRect(),
        pin.getBoundingClientRect(),
      )
    const r = room.getBoundingClientRect()
    const f = clamp(-r.top / Math.max(1, r.height - window.innerHeight))
    hero.flight = f
    root.classList.toggle('flying', f > 0.01)
    // Pieces rise with the ridges, the text comes in last.
    const up = arrived(1200, 250)
    const said = arrived(900, 700)
    if (words) {
      words.style.opacity = String((1 - smooth(0, 0.15, f)) * said)
      words.style.visibility = f > 0.15 ? 'hidden' : ''
    }
    // With reduced motion the pieces just switch off halfway, when the photo jumps.
    const shown = (z: number) => String((hero.reduced ? (f > 0.5 ? 0 : 1) : nearFade(z, f)) * up)
    if (title) title.style.opacity = shown(DEPTH.title)
    if (portrait) portrait.style.opacity = shown(DEPTH.portrait)
    if (metal) metal.style.opacity = shown(DEPTH.metal)
    // Photo and card show the same image in the same box, so the swap is invisible. On the way
    // back the card lets go once its shadow box has closed, and the photo rests in the frame
    // from 0.95 on anyway.
    const landed = f > LANDED || (hero.card && f > 0.95 && hero.parted > 0.01)
    hero.card = landed
    root.classList.toggle('landed', landed)
    if (chapter) chapter.inert = !landed
    if (photo) photo.style.opacity = landed ? '0' : String(up)
    if (up < 1 || said < 1) frame = requestAnimationFrame(follow)
  }
  // Keep each piece's markup label centred on it as the scene turns. Above the arches, since their
  // feet are in the mist, and below the drop.
  const whispers = [
    { piece: photo, z: DEPTH.photo, under: false },
    { piece: portrait, z: DEPTH.portrait, under: false },
    { piece: metal, z: DEPTH.metal, under: true },
  ]
  let held = 0
  const hold = (): void => {
    held = requestAnimationFrame(hold)
    // Hidden during the flight, and offscreen they'd widen the page.
    if (hero.flight > 0.01) return
    for (const { piece, z, under } of whispers) {
      const whisper = piece?.querySelector<HTMLElement>('.whisper')
      const shape = piece?.querySelector<HTMLElement>('[data-dio]')
      if (!piece || !whisper || !shape) continue
      const r = shape.getBoundingClientRect()
      const cx = r.left + r.width / 2 - window.innerWidth / 2
      const cy = window.innerHeight / 2 - (r.top + r.height / 2)
      // The drop's radius is 0.42 of its box. An arch tops out at its box top.
      const y = under ? cy - 0.42 * Math.min(r.width, r.height) : cy + r.height / 2
      const p = seen(cx, y, z)
      const box = piece.getBoundingClientRect()
      const left = window.innerWidth / 2 + p.x - box.left
      const top = window.innerHeight / 2 - p.y - box.top + (under ? 12 : -12)
      whisper.style.transform = `translate(${left}px, ${top}px) translate(-50%, ${under ? '0' : '-100%'})`
    }
  }
  held = requestAnimationFrame(hold)
  const intent = (): void => void load('/work/ridges/').catch(() => {})
  // Page background follows the sky colour of the chapter on screen.
  let tinted = 0
  const tint = (): void => {
    tinted = 0
    const sky = skyAt()
    if (!sky) return
    root.style.backgroundColor = sky
    root.style.setProperty('--sky', sky)
    const dawnRoom = document.querySelector('#dawn')
    root.classList.toggle(
      'at-dawn',
      !!dawnRoom && dawnRoom.getBoundingClientRect().top < window.innerHeight * 0.4,
    )
  }
  const queueTint = (): void => {
    if (!tinted) tinted = requestAnimationFrame(tint)
  }
  const unmountChapters = mountChapters(app)
  // Warm up the chapters below once the scene has settled.
  const arrivedAt = new Promise<void>((resolve) => {
    const check = (): void => {
      if (hero.start && performance.now() - hero.start > 3500) resolve()
      else setTimeout(check, 250)
    }
    check()
  })
  const stopWarming = warmAhead(
    app,
    [...document.querySelectorAll('.landing [data-dio], .deck .card, .room [data-dio]')],
    arrivedAt,
  )
  // Lenis fires before the frame that draws the step, so the flight stays in sync with it.
  const offFollow = lenis.on('scroll', follow)
  addEventListener('scroll', queueTint, { passive: true })
  addEventListener('resize', follow)
  tint()
  chapter?.addEventListener('pointerenter', intent, { once: true })
  chapter?.addEventListener('focusin', intent, { once: true })
  follow()
  let intro = 0
  if (!root.classList.contains('whispered')) {
    const wait = (): void => {
      if (hero.start && performance.now() - hero.start > 2600) {
        root.classList.add('whispering', 'whispered')
        intro = window.setTimeout(
          () => root.classList.remove('whispering'),
          hero.reduced ? 4000 : 3400,
        )
      } else intro = window.setTimeout(wait, 200)
    }
    wait()
  }
  if (!root.classList.contains('gl') && !document.querySelector('.loader')) {
    const scene = document.querySelector('[data-dio~="scene"]')
    const since = performance.now()
    const drawn = (): void => {
      if (scene?.getAttribute('data-dio-state') === 'live') root.classList.add('gl')
      else if (performance.now() - since < 8000) intro = window.setTimeout(drawn, 150)
    }
    drawn()
  }
  return () => {
    clearTimeout(intro)
    root.classList.remove('whispering')
    cancelAnimationFrame(frame)
    cancelAnimationFrame(held)
    cancelAnimationFrame(tinted)
    unmountChapters()
    stopWarming()
    offFollow()
    removeEventListener('scroll', queueTint)
    removeEventListener('resize', follow)
    // Keep the background colour, the next page's paper rises over it.
    root.classList.remove('flying', 'landed')
    hero.card = false
  }
}

function mountWork(): () => void {
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') back()
  }
  addEventListener('keydown', key)
  const offLantern = mountLantern(app)
  return () => {
    removeEventListener('keydown', key)
    offLantern()
  }
}

// The header switch disables every effect and leaves the plain HTML, same markup and layout.
const offs = new Map<string, () => void>()
const flatten = (): void => {
  if (!root.classList.contains('flat-on')) return
  void ready(app).then(() => {
    for (const el of document.querySelectorAll('[data-dio]')) {
      for (const name of (el.getAttribute('data-dio') ?? '').split(/\s+/)) {
        if (name && !offs.has(name)) offs.set(name, app.effects.disable(name))
      }
    }
  })
}
const setFlat = (on: boolean): void => {
  root.classList.toggle('flat-on', on)
  for (const button of document.querySelectorAll('.flat'))
    button.setAttribute('aria-pressed', String(on))
  if (on) flatten()
  else {
    for (const off of offs.values()) off()
    offs.clear()
  }
}
document.addEventListener('click', (e) => {
  const target = e.target as Element | null
  if (target?.closest('.flat, .flat-link')) setFlat(!root.classList.contains('flat-on'))
  const copy = target?.closest<HTMLElement>('[data-copy]')
  if (copy) {
    void navigator.clipboard?.writeText(copy.dataset.copy ?? '').then(() => {
      const done = copy.querySelector('.install-done')
      if (!done) return
      done.textContent = 'copied'
      setTimeout(() => (done.textContent = ''), 1400)
    })
  }
})

const mount = (): (() => void) => {
  flatten()
  for (const button of document.querySelectorAll('.flat')) {
    button.setAttribute('aria-pressed', String(root.classList.contains('flat-on')))
  }
  // #page, not the fading clone of the previous one.
  return document.querySelector('#page .hero') ? mountHero() : mountWork()
}
let unmount = mount()

// Client-side navigation between our own pages, so the canvas survives and pictures can fly.
// Other links behave normally.
const ROUTES = new Set(['/', '/work/ridges/', '/work/lantern/'])
const pages = new Map<string, Promise<Document>>()

function load(href: string): Promise<Document> {
  const path = new URL(href, location.href).pathname
  let page = pages.get(path)
  if (!page) {
    page = fetch(path)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${path}`))))
      .then((html) => new DOMParser().parseFromString(html, 'text/html'))
    pages.set(path, page)
    page.catch(() => pages.delete(path))
  }
  return page
}

// Timer that drops night-page once the sheet has sunk.
let dusking = 0

// Landscape scroll position when leaving for a work page.
let landscapeY: number | undefined

// Where the hero ends. The photo rests in its frame there.
function heroEnd(): number {
  const room = document.querySelector<HTMLElement>('.hero')
  return room ? room.offsetTop + room.offsetHeight - window.innerHeight : 0
}

const inOut = (t: number): number => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2)

async function go(href: string, push: boolean): Promise<void> {
  const url = new URL(href, location.href)
  let doc: Document
  try {
    doc = await load(url.href)
  } catch {
    location.assign(url)
    return
  }
  const next = doc.getElementById('page')
  const page = document.getElementById('page')
  if (!next || !page) {
    location.assign(url)
    return
  }
  const work = doc.documentElement.classList.contains('on-work')
  if (document.querySelector('#page .hero')) landscapeY = scrollY
  const night = doc.documentElement.classList.contains('night-page')
  // The lantern keeps the tint it had when it left.
  for (const el of next.querySelectorAll('[data-dio~="model"]'))
    el.setAttribute('data-dio-tint', currentTint())
  // Flights start from the picture on screen, so scroll a work page back to the top first.
  if (!document.querySelector('#page .hero') && scrollY > 4 && !hero.reduced) {
    lenis.scrollTo(0, { duration: 0.8 })
    const since = performance.now()
    while (scrollY > 4 && performance.now() - since < 900)
      await new Promise((r) => setTimeout(r, 40))
  }
  void transition(
    app,
    () => {
      unmount()
      fadeOut(page)
      page.replaceWith(document.importNode(next, true))
      document.title = doc.title
      // CSS raises or sinks the work page's paper sheet on this class.
      root.classList.toggle('on-work', work)
      // A rising sheet switches paper at once, a sinking one keeps it until it's gone.
      clearTimeout(dusking)
      if (work) root.classList.toggle('night-page', night)
      else dusking = window.setTimeout(() => root.classList.remove('night-page'), 1200)
      if (push) history.pushState({ dio: true }, '', url)
      shown = url.pathname
      // Return to where the reader left the landscape so the picture lands in its own place.
      // Resize first or Lenis clamps to the old page's height.
      lenis.resize()
      lenis.scrollTo(work ? 0 : (landscapeY ?? heroEnd()), { immediate: true, force: true })
      unmount = mount()
    },
    // Paired pictures fly for 1.25 s. Unpaired ones leave or enter their own way (the burn on the
    // lantern page) or fade.
    { duration: 1.25, ease: inOut, leave: 0.9, enter: 0.7 },
  )
}

// Fades the old page's text out instead of cutting it in one frame. The clone sits under the
// canvas without its 3D elements, whose copies fly or leave on their own.
function fadeOut(page: HTMLElement): void {
  if (hero.reduced) return
  const picture = page.cloneNode(true) as HTMLElement
  for (const el of picture.querySelectorAll<HTMLElement>(
    '[data-dio], [data-dio-key], .loader, .dusk',
  )) {
    for (const name of el.getAttributeNames())
      if (name.startsWith('data-dio')) el.removeAttribute(name)
    el.style.visibility = 'hidden'
  }
  for (const el of picture.querySelectorAll('[id]')) el.removeAttribute('id')
  picture.removeAttribute('id')
  picture.className = 'page-leaving'
  picture.inert = true
  picture.setAttribute('aria-hidden', 'true')
  picture.style.top = `${-window.scrollY}px`
  picture.addEventListener('animationend', () => picture.remove(), { once: true })
  setTimeout(() => picture.remove(), 1200)
  document.body.append(picture)
}

// Use history.back() when we came from the landscape.
function back(): void {
  if ((history.state as { dio?: boolean } | null)?.dio) history.back()
  else void go('/', true)
}

history.scrollRestoration = 'manual'
// Path on screen. Back and forward within it only scroll.
let shown = location.pathname
addEventListener('popstate', () => {
  if (location.pathname !== shown) {
    void go(location.href, false)
    return
  }
  const y = (history.state as { y?: number } | null)?.y
  const target = location.hash ? document.querySelector<HTMLElement>(location.hash) : null
  if (typeof y === 'number') lenis.scrollTo(y)
  else if (target) lenis.scrollTo(target)
})
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return
  const a = (e.target as Element | null)?.closest('a')
  if (!a || a.target || a.hasAttribute('download')) return
  const url = new URL(a.href)
  if (url.origin !== location.origin || !ROUTES.has(url.pathname)) return
  e.preventDefault()
  if (a.hasAttribute('data-back')) back()
  else if (url.pathname !== location.pathname) void go(url.href, true)
  else if (url.hash) {
    // Same-page anchor. Scroll there and push a history entry.
    const target = document.querySelector<HTMLElement>(url.hash)
    if (!target) return
    // Save the scroll position so Back returns here.
    history.replaceState({ ...(history.state as object | null), y: scrollY }, '')
    history.pushState({ dio: true }, '', url)
    lenis.scrollTo(target)
  }
})
