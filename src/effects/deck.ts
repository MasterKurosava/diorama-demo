import type { EffectContext, EffectHandle } from 'diorama'
import { effect } from 'diorama'
import { card } from './_deck-card'
import { clamp, D, smooth } from './_hero'

type Layer = ReturnType<EffectContext['layers']>[number]
type Instance = EffectHandle['instances'][number]

/** Centre in page px, turn in radians (clockwise, as in CSS), size. */
interface Box {
  x: number
  y: number
  turn: number
  width: number
  height: number
}
const KEYS = ['x', 'y', 'turn', 'width', 'height'] as const

interface Spring {
  x: number
  v: number
}

/** Stiffness (1/s^2) and damping ratio for the flight and the hover lift. */
const FLY = { k: 150, zeta: 0.74 }
const LIFT = { k: 240, zeta: 0.6 }
/** Depth step between copies in px, so later cards lie on top as in the DOM. */
const LAYER = 0.8
/** Rise in px at full speed and under the pointer. */
const FLIGHT = 44
const HOVER = 34
/** px/s at which a card reaches full flight height. */
const FAST = 1500
/** How far a covered card slides out on hover, as a share of its height. */
const PEEK = 0.14
/** Decks with cards still moving, read by `animate`. */
const moving = new WeakSet<Element>()

/** Steps a damped spring towards `to`. Returns true once it has settled. */
function step(s: Spring, to: number, dt: number, { k, zeta }: typeof FLY, rest: number): boolean {
  const n = Math.max(1, Math.ceil(dt * 240))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    s.v += (k * (to - s.x) - 2 * zeta * Math.sqrt(k) * s.v) * h
    s.x += s.v * h
  }
  if (Math.abs(to - s.x) > rest || Math.abs(s.v) > rest * 20) return false
  s.x = to
  s.v = 0
  return true
}

/** Separating axis test for two rotated boxes, padded by `margin` px. */
function overlaps(a: Box, b: Box, margin = 0): boolean {
  const extent = (q: Box, ux: number, uy: number): number => {
    const c = Math.cos(q.turn)
    const s = Math.sin(q.turn)
    return (Math.abs(ux * c + uy * s) * q.width + Math.abs(uy * c - ux * s) * q.height) / 2
  }
  for (const { turn } of [a, b]) {
    for (const [ux, uy] of [
      [Math.cos(turn), Math.sin(turn)],
      [-Math.sin(turn), Math.cos(turn)],
    ] as const) {
      const d = Math.abs((a.x - b.x) * ux + (a.y - b.y) * uy)
      if (d > extent(a, ux, uy) + extent(b, ux, uy) + margin) return false
    }
  }
  return true
}

const piled = (boxes: readonly Box[]): boolean =>
  boxes.some((a, i) => boxes.some((b, j) => j > i && overlaps(a, b, -1)))

function radians(css: string): number {
  const v = Number.parseFloat(css) || 0
  if (css.endsWith('grad')) return (v * Math.PI) / 200
  if (css.endsWith('rad')) return v
  if (css.endsWith('turn')) return v * 2 * Math.PI
  return (v * Math.PI) / 180
}

interface Card {
  readonly el: HTMLElement
  readonly last: Box
  /** Queued layout boxes, each due at its own time because of the stagger. */
  readonly history: { readonly at: number; readonly box: Box }[]
  readonly goal: Box
  readonly p: Box
  readonly v: Box
  /** Flight height in px. Lift and peek are 0..1. */
  rise: number
  readonly lift: Spring
  readonly peek: Spring
  leanX: number
  leanY: number
  /** Last computed transform string and the turn and scale parsed from it. */
  css: string
  turn: number
  scale: number
  instance: Instance | undefined
}

// Cards whose copies follow the CSS layout (grid, row, stack, fan). The DOM jumps to a new layout
// at once, and the copies fly there on springs, staggered, tilting and bowing with speed. Hover
// lifts a card, or slides it out from under the ones on top.
//
// CSS stays the source of truth for boxes, turns, stacking and hit tests. A card only rises
// where nothing later in the document covers it, so the draw order of the copies never jumps.
export default effect(
  { items: '.card', stagger: 0.045 },
  { animate: ({ element }) => moving.has(element) },
  ({ element, params, layers, attach, pose, render, app, invalidate, onDispose, signal }) => {
    const cards = layers(params.items)
    const handle = attach(params.items, card)
    const state = new Map<Element, Card>()
    const point = { x: 0, y: 0 }
    let clock = 0
    let hovered: Element | null = null

    // Layout changes need a frame. Scroll, window resize and fonts already trigger one.
    const watch = new MutationObserver(() => invalidate())
    watch.observe(element, { attributes: true, attributeFilter: ['class', 'style'], subtree: true })
    const sizes = new ResizeObserver(() => invalidate())
    sizes.observe(element)
    onDispose(() => {
      watch.disconnect()
      sizes.disconnect()
    })
    // Use the DOM hit test so transforms and stacking are respected.
    const host = element as HTMLElement
    const hover = (next: Element | null): void => {
      if (next === hovered) return
      hovered = next
      invalidate()
    }
    host.addEventListener(
      'pointerover',
      (e) => {
        const found = (e.target as Element | null)?.closest(params.items) ?? null
        hover(found && found !== element && element.contains(found) ? found : null)
      },
      { signal },
    )
    host.addEventListener('pointerleave', () => hover(null), { signal })

    const measure = (layer: Layer, c: Card, sx: number, sy: number): Box => {
      // The runtime gives the transformed box. The turn and untransformed size have to come from
      // the computed transforms and offset size.
      const style = getComputedStyle(c.el)
      const css = `${style.transform}|${style.rotate}|${style.scale}`
      if (css !== c.css) {
        c.css = css
        const m = style.transform !== 'none' ? new DOMMatrixReadOnly(style.transform) : null
        // `rotate: 12deg` or `rotate: z 12deg`; `scale: 1.1` or `scale: 1.1 0.9`.
        const rotate = style.rotate !== 'none' ? (style.rotate.split(' ').at(-1) ?? '') : ''
        const scale = style.scale !== 'none' ? Number.parseFloat(style.scale) || 1 : 1
        c.turn = (m ? Math.atan2(m.b, m.a) : 0) + radians(rotate)
        c.scale = (m ? Math.hypot(m.a, m.b) : 1) * scale
      }
      const i = layer.input
      return {
        x: i.x + i.width / 2 + sx,
        y: i.y + i.height / 2 + sy,
        turn: c.turn,
        width: c.el.offsetWidth * c.scale,
        height: c.el.offsetHeight * c.scale,
      }
    }

    // New cards start at rest in their layout box.
    const add = (layer: Layer, sx: number, sy: number): Card => {
      const zero = { x: 0, y: 0, turn: 0, width: 0, height: 0 }
      const c: Card = {
        el: layer.element as HTMLElement,
        last: { ...zero },
        history: [],
        goal: { ...zero },
        p: { ...zero },
        v: { ...zero },
        rise: 0,
        lift: { x: 0, v: 0 },
        peek: { x: 0, v: 0 },
        leanX: 0,
        leanY: 0,
        css: '',
        turn: 0,
        scale: 1,
        instance: undefined,
      }
      const box = measure(layer, c, sx, sy)
      Object.assign(c.last, box)
      Object.assign(c.goal, box)
      Object.assign(c.p, box)
      c.history.push({ at: clock, box })
      state.set(layer.element, c)
      return c
    }

    return (input) => {
      const dt = Math.min(input.delta, 1 / 20)
      clock += dt
      const reduced = input.reducedMotion
      const { x: sx, y: sy } = app.scroll.state
      let busy = false
      if (state.size > cards.length) {
        for (const el of state.keys()) if (!cards.some((l) => l.element === el)) state.delete(el)
      }

      const deck: { layer: Layer; c: Card; box: Box }[] = []
      for (const layer of cards) {
        if (!layer.input.width || !layer.input.height) continue
        const c = state.get(layer.element) ?? add(layer, sx, sy)
        deck.push({ layer, c, box: measure(layer, c, sx, sy) })
      }

      // Stagger the changes. Dealing from a pile starts at the top and building one starts at
      // the bottom, so no card has to pass the ones lying on it.
      const changed = deck.filter(({ c, box }) =>
        KEYS.some((k) => Math.abs(box[k] - c.last[k]) > 0.01),
      )
      if (changed.length) {
        const reverse = !piled(deck.map((d) => d.box)) && piled(deck.map((d) => d.c.last))
        for (const d of changed) {
          const i = deck.indexOf(d)
          const rank = reverse ? deck.length - 1 - i : i
          Object.assign(d.c.last, d.box)
          d.c.history.push({ at: clock + (reduced ? 0 : rank * params.stagger), box: d.box })
        }
      }

      for (const { c } of deck) {
        const { history, goal, p, v } = c
        let due = -1
        for (const [e, entry] of history.entries()) if (entry.at <= clock) due = e
        if (due > 0) history.splice(0, due)
        if (due >= 0 && history[0]) Object.assign(goal, history[0].box)
        if (history.length > 1 || due < 0) busy = true
        // Take the short way round.
        goal.turn += Math.round((p.turn - goal.turn) / (2 * Math.PI)) * 2 * Math.PI
        if (reduced) {
          Object.assign(p, goal)
          for (const k of KEYS) v[k] = 0
          continue
        }
        for (const k of KEYS) {
          const s = { x: p[k], v: v[k] }
          if (!step(s, goal[k], dt, FLY, k === 'turn' ? 1e-4 : 0.02)) busy = true
          p[k] = s.x
          v[k] = s.v
        }
      }

      for (const [i, { layer, c }] of deck.entries()) {
        const { p, v } = c
        const speed = Math.hypot(v.x, v.y)
        // Stay down if a later card covers the landing spot or is close on the way.
        let under = false
        let near = false
        for (const { c: o } of deck.slice(i + 1)) {
          under ||= overlaps(c.goal, o.goal, -1)
          near ||= overlaps(p, o.p, 8 + (speed + Math.hypot(o.v.x, o.v.y)) * 0.08)
        }
        const covered = under || near

        const want = hovered === c.el ? 1 : 0
        const up = want && !covered ? 1 : 0
        const fly = covered ? 0 : FLIGHT * smooth(0, 1, speed / FAST)
        if (reduced) {
          c.rise = 0
          Object.assign(c.lift, { x: up, v: 0 })
          Object.assign(c.peek, { x: want, v: 0 })
        } else {
          // Drop fast and rise slowly, so a card is down before it meets one lying on it.
          c.rise += (fly - c.rise) * (1 - Math.exp(-dt * (fly < c.rise ? 30 : 10)))
          if (Math.abs(fly - c.rise) > 0.05) busy = true
          else c.rise = fly
          if (!step(c.lift, up, dt, LIFT, 1e-3)) busy = true
          if (!step(c.peek, want, dt, LIFT, 1e-3)) busy = true
        }

        // Lean away from the pointer as if pressed.
        const ease = reduced ? 1 : 1 - Math.exp(-dt * 12)
        const tx = want && !reduced ? layer.input.pointer.x - 0.5 : 0
        const ty = want && !reduced ? layer.input.pointer.y - 0.5 : 0
        c.leanX += (tx - c.leanX) * ease
        c.leanY += (ty - c.leanY) * ease
        if (Math.abs(tx - c.leanX) + Math.abs(ty - c.leanY) > 1e-3) busy = true
        else {
          c.leanX = tx
          c.leanY = ty
        }

        // In flight the leading edge dips, the card swings and the paper bows.
        const lean = 0.3 * clamp(Math.max(c.lift.x, c.peek.x * 0.5))
        const rotateX = clamp(v.y * 0.00022 - c.leanY * lean, -0.45, 0.45)
        const rotateY = clamp(v.x * 0.00022 + c.leanX * lean, -0.45, 0.45)
        const swing = clamp(-v.x * 0.00004, -0.08, 0.08)
        const bendX = Math.min(0.11, Math.abs(v.x) * 0.00006)
        const bendY = Math.min(0.11, Math.abs(v.y) * 0.00006)
        // Hover slides it out along its length, further if it's under other cards.
        const out = c.peek.x * p.height * (under ? PEEK : 0.03)
        const cx = p.x + Math.sin(p.turn) * out
        const cy = p.y - Math.cos(p.turn) * out

        // Scale out the stacking depth so a resting copy covers its box exactly. The rise is left
        // in, so a lifted card comes towards you.
        const rise = c.rise + HOVER * c.lift.x
        const k = (D - i * LAYER) / D
        render.toWorld(cx - sx, cy - sy, point)
        pose(
          layer,
          {
            x: point.x * k,
            y: point.y * k,
            z: i * LAYER + rise,
            rotateX,
            rotateY,
            rotateZ: swing - p.turn,
            width: p.width * k,
            height: p.height * k,
            scale: 1 + 0.015 * c.lift.x,
          },
          1,
        )

        // Rounded so a card at rest writes nothing.
        c.instance ??= handle.instances.find((x) => x.element === c.el)
        c.instance?.set({
          bend: [Math.round(bendX * 1e4) / 1e4, Math.round(bendY * 1e4) / 1e4],
          lift: Math.round(clamp(rise / HOVER, 0, 1.5) * 1e3) / 1e3,
        })
      }
      if (busy) moving.add(element)
      else moving.delete(element)
    }
  },
)
