// Plays an effect that runs once on entry (reveal, text-reveal) again inside a live example. Such
// an effect stays shown when its setup finds the element already on screen, so nothing the reader
// has seen disappears. A replay drives the copy's presence from 0 to 1 instead, the way a page
// transition brings an entering element in, with the effect's own duration, delay and easing.
import { app } from '../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element, effect: string) =>
  app.effects.get(element, effect as never) as unknown as
    | Instance
    | undefined

/** Presence that the effect's smoothstep turns into `y`. */
const unsmooth = (y: number) => 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3)
const expoOut = (p: number) =>
  p <= 0 ? 0 : p >= 1 ? 1 : 1 - 2 ** (-10 * p)

const playing = new WeakMap<Element, AbortController>()

export interface ReplayOptions {
  /** Hidden this long before it starts, ms: a switch that rebuilds the effect needs the time. */
  readonly wait?: number
}

/** Plays it again; returns false while the effect does not run yet. */
export function replay(
  element: Element,
  effect: string,
  options: ReplayOptions = {},
): boolean {
  const instance = instanceOf(element, effect)
  if (instance?.status.value !== 'running') return false
  playing.get(element)?.abort()
  const stop = new AbortController()
  playing.set(element, stop)
  const copy = app.effects.take(element, {
    leave: 'release',
    signal: stop.signal,
  })
  copy.presence = 0
  const start = performance.now() + (options.wait ?? 0)
  const step = (now: number) => {
    if (stop.signal.aborted) return
    const duration = Number(instance.params.duration ?? 1.2) * 1000
    const delay = Number(instance.params.delay ?? 0) * 1000
    const p = (now - start - delay) / Math.max(duration, 1)
    copy.presence = unsmooth(expoOut(p))
    if (p < 1) requestAnimationFrame(step)
    else {
      stop.abort()
      playing.delete(element)
    }
  }
  requestAnimationFrame(step)
  return true
}

/** Stops a replay and shows the element as it is. */
export function settle(element: Element): void {
  playing.get(element)?.abort()
  playing.delete(element)
}

/** Resolves once the instance runs, or false after `ms`. */
export function running(
  element: Element,
  effect: string,
  ms = 15_000,
): Promise<boolean> {
  const until = performance.now() + ms
  return new Promise((resolve) => {
    const check = () => {
      if (!element.isConnected) return resolve(false)
      if (instanceOf(element, effect)?.status.value === 'running')
        return resolve(true)
      if (performance.now() > until) return resolve(false)
      requestAnimationFrame(check)
    }
    check()
  })
}

/** Whether any of the element is in the viewport now. */
export function onScreen(element: Element): boolean {
  const r = element.getBoundingClientRect()
  return (
    r.bottom > 0 &&
    r.top < innerHeight &&
    r.right > 0 &&
    r.left < innerWidth
  )
}
