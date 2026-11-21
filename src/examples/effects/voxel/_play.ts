// Builds a voxel heading again inside an example. A heading on screen at load stays as it is,
// so a replay drives the copy's presence from 0 to 1 at the effect's own pace: presence times
// the whole span is the time since the trigger, so every cube falls with its own duration,
// stagger and delay.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'voxel' as never) as unknown as
    | Instance
    | undefined

/** Seconds from the trigger until the last column has landed, and handed back to the text. */
function span(element: Element, p: Record<string, unknown>): number {
  const em = Number.parseFloat(getComputedStyle(element).fontSize) || 16
  // The wave runs across the widest line, plus a little for the rows and lines below.
  const wave = element.getBoundingClientRect().width / em + 0.8
  const keep = p.style === 'pixels' || p.trigger === 'hover'
  return (
    Number(p.delay ?? 0) +
    Number(p.stagger ?? 0.1) * wave +
    Math.max(Number(p.duration ?? 0.9), 1e-3) * 1.3 +
    (keep ? 0 : 0.7)
  )
}

const playing = new WeakMap<Element, AbortController>()

/** Builds it again, hidden for `wait` ms first; false while the effect does not run yet. */
export function play(element: Element, wait = 0): boolean {
  const instance = instanceOf(element)
  if (instance?.status.value !== 'running') return false
  playing.get(element)?.abort()
  const stop = new AbortController()
  playing.set(element, stop)
  const copy = app.effects.take(element, {
    leave: 'release',
    signal: stop.signal,
  })
  copy.presence = 0
  const start = performance.now() + wait
  const step = (now: number) => {
    if (stop.signal.aborted) return
    const total = span(element, instance.params)
    const t = Math.max(0, (now - start) / 1000)
    copy.presence = Math.min(1, t / total)
    if (t < total) requestAnimationFrame(step)
    else {
      stop.abort()
      playing.delete(element)
    }
  }
  requestAnimationFrame(step)
  return true
}

/** Stops a replay and shows the heading as it is. */
export function settle(element: Element): void {
  playing.get(element)?.abort()
  playing.delete(element)
}
