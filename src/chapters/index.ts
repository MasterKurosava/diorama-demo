// Chapters below the hero, their styles and scripts.
import type { App } from 'diorama'
import './chapters.css'
import './why.css'
import './map.css'
import './layout.css'
import './night.css'
import './lantern.css'
import './editor.css'
import './dawn.css'
import * as dawn from './dawn'
import * as editor from './editor'
import * as lantern from './lantern'
import * as layout from './layout'
import * as map from './map'
import * as night from './night'

const scripts: { mount(app: App): () => void }[] = [map, layout, night, lantern, editor, dawn]

export { currentTint, mount as mountLantern } from './lantern'

export function mountChapters(app: App): () => void {
  const offs = scripts.map((chapter) => chapter.mount(app))
  return () => {
    for (const off of offs) off()
  }
}

/** Background colour for the current scroll, blending each chapter's data-sky into the next. */
export function skyAt(): string | undefined {
  const rooms = [...document.querySelectorAll<HTMLElement>('[data-sky]')]
  if (!rooms.length) return undefined
  const mid = window.innerHeight / 2
  let from = rooms[0] as HTMLElement
  let to = from
  let k = 0
  for (const [i, room] of rooms.entries()) {
    const r = room.getBoundingClientRect()
    if (r.top <= mid) {
      from = room
      to = rooms[i + 1] ?? room
      const next = to.getBoundingClientRect()
      // Blend over the half screen before the next room's top reaches the middle.
      k =
        to === room ? 0 : Math.min(1, Math.max(0, 1 - (next.top - mid) / (window.innerHeight / 2)))
    }
  }
  return mixHex(from.dataset.sky ?? '#4b1519', to.dataset.sky ?? '#4b1519', k)
}

function mixHex(a: string, b: string, k: number): string {
  const p = (h: string, i: number) => Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k))
  return `rgb(${c.join(' ')})`
}
