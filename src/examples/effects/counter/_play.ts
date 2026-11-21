// Counts a number again inside an example. It counts once on entry and stays shown for a number
// already on screen, so a replay drives the copy's presence from 0 to 1 at the effect's own pace:
// presence times the whole span is the time since the trigger.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'counter' as never) as unknown as
    | Instance
    | undefined

/** Seconds from the trigger until the digits have landed and folded back into the text. */
function span(element: Element, p: Record<string, unknown>): number {
  // The digits of the first number: groups of digits joined by single separators.
  const number =
    /[0-9](?:[0-9]|[.,'\u2019\s\u00a0\u202f](?=[0-9]))*/.exec(
      element.textContent ?? '',
    )
  const digits = (number?.[0].match(/[0-9]/g) ?? []).length
  const later =
    p.style === 'odometer'
      ? 0
      : Math.max(0, digits - 1) * Number(p.stagger ?? 0.12)
  return (
    Number(p.delay ?? 0) +
    Math.max(Number(p.duration ?? 2), 0.05) +
    later +
    0.6
  )
}

const playing = new WeakMap<Element, AbortController>()

/** Counts it again, hidden for `wait` ms first; false while the effect does not run yet. */
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

/** Stops a replay and shows the number as it is. */
export function settle(element: Element): void {
  playing.get(element)?.abort()
  playing.delete(element)
}
