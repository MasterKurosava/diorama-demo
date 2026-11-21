// Blows a dust heading away inside an example and gathers it back. The effect reads a leaving
// copy as sand that blows away, so a replay drives the copy's presence from 1 down to 0 at the
// effect's own pace, holds a moment, and brings it back up a little faster.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'dust' as never) as unknown as
    | Instance
    | undefined

const playing = new WeakMap<Element, AbortController>()

/** Blows it away and back, after `wait` ms; false while the effect does not run yet. */
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
  copy.presence = 1
  const start = performance.now() + wait
  const step = (now: number) => {
    if (stop.signal.aborted) return
    const away = Math.max(Number(instance.params.duration ?? 2.2), 0.3)
    const back = away / 1.6
    const t = Math.max(0, (now - start) / 1000)
    if (t < away) copy.presence = 1 - t / away
    else if (t < away + 0.7) copy.presence = 0
    else copy.presence = Math.min(1, (t - away - 0.7) / back)
    if (t < away + 0.7 + back) requestAnimationFrame(step)
    else {
      stop.abort()
      playing.delete(element)
    }
  }
  requestAnimationFrame(step)
  return true
}

/** Stops a replay and shows the text as it is. */
export function settle(element: Element): void {
  playing.get(element)?.abort()
  playing.delete(element)
}
