import { prefetch } from 'astro:prefetch'
import { navigate } from 'astro:transitions/client'
import { ready } from '@dioramajs/diorama'
import { type Arrival, app, onPage, smoothScroll } from '../diorama'
import {
  aimAt,
  arrived,
  clamp,
  DEPTH,
  hero,
  LANDED,
  nearFade,
  seen,
  smooth,
} from '../effects/_hero'
import { currentTint, mountChapters, mountLantern, skyAt } from './chapters'
import { mountCursor } from './cursor'
import { warmAhead } from './warm'

const root = document.documentElement
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
hero.reduced = reduced.matches
reduced.addEventListener('change', () => {
  hero.reduced = reduced.matches
})

const loader = document.querySelector<HTMLElement>('.loader')
mountCursor()

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
  // overflow: hidden stops the native scroll, but Lenis scrolls from script.
  smoothScroll()?.stop()
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
  smoothScroll()?.start()
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
  const intent = (): void => prefetch('/work/ridges')
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
  const offFollow = smoothScroll()?.on('scroll', follow)
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
    offFollow?.()
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

// Path of the landscape or work page on screen, unset on other pages of the site. Back and
// forward within it only scroll.
let shown: string | undefined

/** A landscape position: the scroll, and the chapter on screen with the distance past its top. */
interface Spot {
  readonly y: number
  readonly room: number
  readonly past: number
}

// Where the reader left the landscape for a work page.
let left: Spot | undefined

const rooms = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('main > *')]

function spot(): Spot {
  let room = 0
  let past = scrollY
  for (const [i, el] of rooms().entries()) {
    const top = el.getBoundingClientRect().top
    if (top <= 0) [room, past] = [i, -top]
  }
  return { y: scrollY, room, past }
}

// Chapters fill parts of the page from script (the swatches, the layout's CSS), and on narrow
// screens those change height, so a raw scroll taken before they mount lands lower on every
// return. Measure it from the chapter instead.
function place(at: Spot): number {
  const el = rooms()[at.room]
  return el ? el.getBoundingClientRect().top + scrollY + at.past : at.y
}

// Where the hero ends. The photo rests in its frame there.
function heroEnd(): number {
  const room = document.querySelector<HTMLElement>('.hero')
  return room ? room.offsetTop + room.offsetHeight - window.innerHeight : 0
}

const mount =
  (page: (arrival: Arrival) => () => void) =>
  (_: Element, arrival: Arrival): (() => void) => {
    shown = location.pathname
    flatten()
    for (const button of document.querySelectorAll('.flat')) {
      button.setAttribute('aria-pressed', String(root.classList.contains('flat-on')))
    }
    const off = page(arrival)
    return () => {
      shown = undefined
      off()
    }
  }

const jump = (y: number): void => {
  const lenis = smoothScroll()
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
  else scrollTo(0, y)
}
const glide = (to: number | HTMLElement): void => {
  const lenis = smoothScroll()
  if (lenis) lenis.scrollTo(to)
  else if (typeof to === 'number') scrollTo({ top: to, behavior: 'smooth' })
  else to.scrollIntoView({ behavior: 'smooth' })
}

onPage(
  '.hero',
  mount((arrival) => {
    // Return to where the reader left the landscape so the picture lands in its own place. Back
    // and forward have their own position, which Astro restores before the chapters mount.
    const link = arrival.type === 'push' || arrival.type === 'replace'
    if (link) jump(left?.y ?? heroEnd())
    const off = mountHero()
    const restored = (history.state as { scrollY?: number } | null)?.scrollY
    const returned = arrival.type === 'traverse' && Math.abs((restored ?? -1) - (left?.y ?? -2)) < 1
    if (left && (link || returned)) {
      smoothScroll()?.resize()
      const y = place(left)
      if (Math.abs(y - scrollY) >= 1) jump(y)
    }
    return off
  }),
)
onPage(
  '.case',
  mount((arrival) => {
    // Pictures land on the cover, so a work page always opens at the top.
    if (arrival.type !== 'load') jump(0)
    return mountWork()
  }),
)

// Timer that drops night-page once the sheet has sunk.
let dusking = 0

document.addEventListener('astro:before-preparation', (event) => {
  if (!shown) return
  if (document.querySelector('.hero')) {
    left = spot()
    return
  }
  // Flights start from the picture on screen, so scroll a work page back to the top first.
  const lenis = smoothScroll()
  if (!lenis || scrollY <= 4 || hero.reduced) return
  const load = event.loader
  event.loader = async () => {
    lenis.scrollTo(0, { duration: 0.8 })
    const since = performance.now()
    const up = async (): Promise<void> => {
      while (scrollY > 4 && performance.now() - since < 900)
        await new Promise((r) => setTimeout(r, 40))
    }
    await Promise.all([load(), up()])
  }
})

document.addEventListener('astro:before-swap', (event) => {
  const next = event.newDocument
  // The loader belongs to the first visit.
  next.querySelector('.loader')?.remove()
  // The lantern keeps the tint it had when it left.
  for (const el of next.querySelectorAll('[data-dio~="lantern"]'))
    el.setAttribute('data-dio-tint', currentTint())
  // A rising sheet switches paper at once, a sinking one keeps it until it's gone.
  clearTimeout(dusking)
  const html = next.documentElement
  if (root.classList.contains('night-page') && !html.classList.contains('on-work')) {
    html.classList.add('night-page')
    dusking = window.setTimeout(() => root.classList.remove('night-page'), 1200)
  }
  // Each page has its own paper sheet: the new one starts where the old one is, and rises or
  // sinks from there once it is in the document.
  const from = document.querySelector('.sheet')
  const sheet = next.querySelector<HTMLElement>('.sheet')
  if (from && sheet) {
    const style = getComputedStyle(from)
    Object.assign(sheet.style, {
      transition: 'none',
      transform: style.transform,
      opacity: style.opacity,
    })
  }
})

document.addEventListener('astro:after-swap', () => {
  const sheet = document.querySelector<HTMLElement>('.sheet')
  if (!sheet?.style.transition) return
  // Commit the starting point, or the sheet would jump to the end.
  getComputedStyle(sheet).transform
  sheet.removeAttribute('style')
})

// Use history.back() when we came from another page of the site.
function back(): void {
  if (((history.state as { index?: number } | null)?.index ?? 0) > 0) history.back()
  else void navigate('/')
}

addEventListener(
  'popstate',
  (e) => {
    if (location.pathname !== shown) return
    // Ahead of Astro, which would swap the page in again.
    e.stopImmediatePropagation()
    const y = (history.state as { scrollY?: number } | null)?.scrollY
    const target = location.hash ? document.querySelector<HTMLElement>(location.hash) : null
    if (typeof y === 'number') glide(y)
    else if (target) glide(target)
  },
  { capture: true },
)
document.addEventListener(
  'click',
  (e) => {
    if (!shown || e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest('a')
    if (!a || a.target || a.hasAttribute('download')) return
    const url = new URL(a.href)
    if (url.origin !== location.origin) return
    if (a.hasAttribute('data-back')) {
      e.preventDefault()
      back()
    } else if (url.pathname === location.pathname && url.hash) {
      // Same-page anchor. Scroll there and push a history entry Back returns from.
      const target = document.querySelector<HTMLElement>(url.hash)
      if (!target) return
      e.preventDefault()
      const state = history.state as { index?: number } | null
      history.replaceState({ ...state, scrollX, scrollY }, '')
      history.pushState({ ...state, index: (state?.index ?? 0) + 1, scrollX, scrollY }, '', url)
      glide(target)
    }
  },
  // Ahead of Astro's own link handler.
  { capture: true },
)
