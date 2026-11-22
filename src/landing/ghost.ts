// The pointer of the effect previews, on the landing: a white arrow that shows what a part of the
// page does with the visitor's own pointer. It moves with pointer events, so the effects answer it
// as they answer a mouse. It plays only while the visitor rests: their first move, touch, key or
// wheel sends it away. On touch screens it is drawn as a fingertip.

export interface Point {
  readonly x: number
  readonly y: number
}
/** Where the hand goes: a fixed point, or one read again on every frame. */
export type Aim = Point | (() => Point)

export interface Hand {
  /** Glides to a point along a slight arc. */
  glide(to: Aim, ms: number): Promise<void>
  /** Follows points given as fractions of a box, one after another, at an even pace. */
  stroke(
    box: () => DOMRect,
    points: readonly (readonly [number, number])[],
    ms: number,
  ): Promise<void>
  /** Presses and lets go where it is; `click` also clicks what is under it. */
  press(click?: boolean): Promise<void>
  down(): void
  up(): void
  wait(ms: number): Promise<void>
}

/** The id of the mouse in Chromium and Firefox, so pointer capture accepts it. */
const ID = 1
const SVG = `<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><path d="M3 2v16l4.2-3.8 2.7 6.1 2.7-1.2-2.7-6h5.8z" fill="#fff" stroke="#16080f" stroke-width="1.4" stroke-linejoin="round"/></svg>`

let hand: HTMLElement | undefined
let x = -100
let y = -100
let under: Element | null = null
let captured: Element | null = null
let buttons = 0
let running: AbortController | undefined
let since = performance.now()
let real: Point | undefined
let tracking = false

/** Center of an element's box. */
export const center =
  (element: Element, fx = 0.5, fy = 0.5): (() => Point) =>
  () => {
    const r = element.getBoundingClientRect()
    return { x: r.left + r.width * fx, y: r.top + r.height * fy }
  }

/** Milliseconds since the visitor last moved, touched, typed or scrolled with the wheel. */
export function quiet(): number {
  track()
  return performance.now() - since
}

/** Where the visitor's own pointer was last seen, if it was. */
export function pointer(): Point | undefined {
  return real
}

export function playing(): boolean {
  return Boolean(running)
}

/** Sends the hand away now. */
export function stop(): void {
  running?.abort()
}

/**
 * Runs a script with the hand. Resolves true when it played to the end, false when the visitor
 * took over or another script was running.
 */
export async function play(script: (hand: Hand) => Promise<void>, from?: Point): Promise<boolean> {
  track()
  if (running) return false
  const own = new AbortController()
  running = own
  const el = mount()
  const { signal } = own
  const start = from ?? { x: innerWidth * 0.62, y: innerHeight * 0.78 }
  x = start.x
  y = start.y
  place(el)
  el.dataset.on = ''
  try {
    await script(steps(signal))
    return true
  } catch (error) {
    if (signal.aborted) return false
    throw error
  } finally {
    if (captured) {
      buttons = 0
      send('pointerup', captured)
      captured = null
    }
    delete el.dataset.down
    delete el.dataset.on
    cross(null)
    if (running === own) running = undefined
  }
}

function steps(signal: AbortSignal): Hand {
  const check = (): void => {
    if (signal.aborted) throw signal.reason
  }
  const frames = (ms: number, step: (p: number) => void): Promise<void> =>
    new Promise((resolve, reject) => {
      const t0 = performance.now()
      const stopped = (): void => {
        cancelAnimationFrame(frame)
        reject(signal.reason)
      }
      let frame = requestAnimationFrame(function tick(now) {
        if (signal.aborted) return stopped()
        const p = ms > 0 ? Math.min(1, (now - t0) / ms) : 1
        step(p)
        if (p < 1) frame = requestAnimationFrame(tick)
        else {
          signal.removeEventListener('abort', stopped)
          resolve()
        }
      })
      signal.addEventListener('abort', stopped, { once: true })
    })

  return {
    async glide(to, ms) {
      check()
      const from = { x, y }
      await frames(ms, (p) => {
        const end = typeof to === 'function' ? to() : to
        const e = ease(p)
        // A hand moves on a shallow arc, not a ruled line.
        const dx = end.x - from.x
        const dy = end.y - from.y
        const bow = Math.sin(Math.PI * e) * 0.08
        move(from.x + dx * e - dy * bow, from.y + dy * e + dx * bow)
      })
    },
    async stroke(box, points, ms) {
      check()
      const at = (i: number): Point => {
        const r = box()
        const [fx, fy] = points[i] ?? [0, 0]
        return { x: r.left + r.width * fx, y: r.top + r.height * fy }
      }
      const lengths = points.slice(1).map((_, i) => {
        const a = at(i)
        const b = at(i + 1)
        return Math.hypot(b.x - a.x, b.y - a.y)
      })
      const total = lengths.reduce((s, l) => s + l, 0) || 1
      await frames(ms, (p) => {
        let d = ease(p) * total
        let i = 0
        while (i < lengths.length - 1 && d > (lengths[i] ?? 0)) d -= lengths[i++] ?? 0
        const a = at(i)
        const b = at(i + 1)
        const f = Math.min(1, d / (lengths[i] || 1))
        move(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
      })
    },
    async press(click = false) {
      this.down()
      await this.wait(150)
      const target = captured ?? under
      this.up()
      if (click && target instanceof HTMLElement) target.click()
      await this.wait(120)
    },
    down() {
      check()
      buttons = 1
      hand?.setAttribute('data-down', '')
      ring()
      const target = under ?? document.documentElement
      send('pointerdown', target)
      captured = target
    },
    up() {
      buttons = 0
      hand?.removeAttribute('data-down')
      const target = captured ?? under
      captured = null
      if (target) send('pointerup', target)
    },
    wait(ms) {
      return frames(ms, () => {})
    },
  }
}

function move(nx: number, ny: number): void {
  x = nx
  y = ny
  if (hand) place(hand)
  const hit = document.elementFromPoint(x, y)
  if (hit !== under) cross(hit)
  send('pointermove', captured ?? hit ?? document.documentElement)
}

/** Pointer out, leave, over and enter, as the browser sends them when the pointer crosses. */
function cross(to: Element | null): void {
  const from = under
  under = to
  if (from) send('pointerout', from, to)
  for (let n = from; n && !(to && n.contains(to)); n = n.parentElement)
    send('pointerleave', n, to, false)
  if (to) send('pointerover', to, from)
  const entered: Element[] = []
  for (let n = to; n && !(from && n.contains(from)); n = n.parentElement) entered.push(n)
  for (const n of entered.reverse()) send('pointerenter', n, from, false)
}

function send(type: string, target: Element, related: Element | null = null, bubbles = true): void {
  const press = type === 'pointerdown' || type === 'pointerup'
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      pointerId: ID,
      pointerType: 'mouse',
      isPrimary: true,
      button: press ? 0 : -1,
      buttons,
      pressure: buttons ? 0.5 : 0,
      relatedTarget: related,
      view: window,
    }),
  )
}

function mount(): HTMLElement {
  if (hand?.isConnected) return hand
  hand = document.createElement('div')
  hand.className = 'ghost'
  hand.setAttribute('aria-hidden', 'true')
  if (matchMedia('(hover: none), (pointer: coarse)').matches) hand.dataset.touch = ''
  hand.innerHTML = `<span class="ghost-hand">${SVG}</span>`
  document.body.append(hand)
  return hand
}

function place(el: HTMLElement): void {
  el.style.translate = `${x}px ${y}px`
}

/** A ring that spreads from the tip when the hand presses. */
function ring(): void {
  if (!hand) return
  const r = document.createElement('i')
  r.className = 'ghost-ring'
  hand.append(r)
  r.addEventListener('animationend', () => r.remove(), { once: true })
}

const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

/** The visitor's own input: it ends a script and restarts the count to the next one. */
function track(): void {
  if (tracking) return
  tracking = true
  const wake = (): void => {
    since = performance.now()
    running?.abort()
  }
  addEventListener(
    'pointermove',
    (e) => {
      if (!e.isTrusted) return
      // Browsers send a still pointer's move after a scroll; only a real move counts.
      if (real && Math.abs(e.clientX - real.x) < 3 && Math.abs(e.clientY - real.y) < 3) return
      real = { x: e.clientX, y: e.clientY }
      wake()
    },
    { passive: true, capture: true },
  )
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const)
    addEventListener(
      type,
      (e) => {
        if (e.isTrusted) wake()
      },
      { passive: true, capture: true },
    )
}
