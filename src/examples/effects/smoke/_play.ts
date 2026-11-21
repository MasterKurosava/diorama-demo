// Plays a smoke heading again inside an example. A copy that leaves a page dissolves into smoke and
// an entering one condenses out of it, so a replay drives the copy's presence: down to 0 quickly,
// then back up to 1 at the effect's own pace.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'smoke' as never) as unknown as
    | Instance
    | undefined

const playing = new WeakMap<Element, AbortController>()

/** Dissolves it and condenses it again after `wait` ms; false while the effect does not run yet. */
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
  const away = 0.9
  const step = (now: number) => {
    if (stop.signal.aborted) return
    const back = Math.max(Number(instance.params.duration ?? 2.4), 0.3)
    const t = Math.max(0, (now - start) / 1000)
    if (t < away) copy.presence = 1 - t / away
    else if (t < away + 0.3) copy.presence = 0
    else copy.presence = Math.min(1, (t - away - 0.3) / back)
    if (t < away + 0.3 + back) requestAnimationFrame(step)
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
