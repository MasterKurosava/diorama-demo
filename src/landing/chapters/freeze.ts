// 04 → 05. The page freezes over as the night comes on screen, and the lantern thaws it: frost
// grows in from the edges of the window, and when the lantern arrives the ice melts outwards from
// it and the meltwater runs down the glass. Both are library effects on one fixed pane; this
// script only writes their live params and keeps the lantern's warm glow on it.
import type { App } from '@dioramajs/diorama'

/** Night counts as on screen once its top passes this share of the viewport. */
const NIGHT = 0.3
/** The lantern takes over once its top passes this share. */
const LANTERN = 0.2

export function mount(_app: App): () => void {
  const pane = document.querySelector<HTMLElement>('.frost-pane')
  const glow = document.querySelector<HTMLElement>('.thaw-glow')
  const night = document.querySelector<HTMLElement>('#night')
  const lantern = document.querySelector<HTMLElement>('#lantern')
  if (!pane || !night || !lantern) return () => {}
  const model = lantern.querySelector<HTMLElement>('.lantern-model') ?? lantern
  let frozen = false
  let thaws = 0
  let frame = 0

  const set = (name: string, value: number): void =>
    pane.setAttribute(`data-dio-${name}`, String(Math.round(value * 1000) / 1000))
  /** Centre of the lantern's light on screen. */
  const light = (): { x: number; y: number } => {
    const m = model.getBoundingClientRect()
    return { x: m.left + m.width / 2, y: m.top + m.height * 0.45 }
  }
  const place = (): void => {
    if (!glow?.classList.contains('on')) return
    const { x, y } = light()
    glow.style.transform = `translate(${x - glow.offsetWidth / 2}px, ${y - glow.offsetHeight / 2}px)`
  }

  const check = (): void => {
    frame = 0
    place()
    const vh = window.innerHeight
    const n = night.getBoundingClientRect()
    const l = lantern.getBoundingClientRect()
    const atNight = n.top < vh * NIGHT && l.top > vh * LANTERN
    if (atNight === frozen) return
    frozen = atNight
    if (frozen) {
      glow?.classList.remove('on')
      set('frost-cover', 1)
      return
    }
    if (l.top <= vh * LANTERN) {
      // The warmth of the lantern: the thaw starts at its glow and the drops follow the front.
      const { x, y } = light()
      const fx = Math.min(1, Math.max(0, x / window.innerWidth))
      const fy = Math.min(1, Math.max(0, y / vh))
      set('frost-x', fx)
      set('frost-y', fy)
      set('drops-x', fx)
      set('drops-y', fy)
      set('drops-fire', ++thaws)
      // Only where the frost is really drawn: without WebGL the page has no ice to thaw.
      if (glow && pane.matches('[data-dio-state="live"], [data-dio-state="drawn"]')) {
        glow.classList.remove('on')
        void glow.offsetWidth
        glow.classList.add('on')
        place()
      }
    } else {
      // Back up into the evening: the frost lifts from the top without running water.
      set('frost-x', 0.5)
      set('frost-y', 0)
      glow?.classList.remove('on')
    }
    set('frost-cover', 0)
  }
  const queue = (): void => {
    if (!frame) frame = requestAnimationFrame(check)
  }
  addEventListener('scroll', queue, { passive: true })
  addEventListener('resize', queue)
  check()
  return () => {
    removeEventListener('scroll', queue)
    removeEventListener('resize', queue)
    cancelAnimationFrame(frame)
    glow?.classList.remove('on')
  }
}
