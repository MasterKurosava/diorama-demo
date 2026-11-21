// Plays an assemble heading again inside an example. A heading on screen at load stays as it is,
// so a replay drives the copy's presence from 0 to 1 at the effect's own pace: presence times
// the whole span is the time since the trigger, so every letter gathers with its own duration,
// stagger and delay.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'assemble' as never) as unknown as
    | Instance
    | undefined

const graphemes = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
})

/** Seconds from the trigger until the last letter is crisp, as the effect counts them. */
function span(element: Element, p: Record<string, unknown>): number {
  const letters = [
    ...graphemes.segment(element.textContent ?? ''),
  ].filter((s) => /\S/.test(s.segment))
  const duration = Math.max(Number(p.duration ?? 1.4), 1e-3)
  return (
    Number(p.delay ?? 0) +
    Math.max(0, letters.length - 1) * Number(p.stagger ?? 0.03) +
    duration * 1.35 +
    0.2
  )
}

const playing = new WeakMap<Element, AbortController>()

/** Plays it again, hidden for `wait` ms first; false while the effect does not run yet. */
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

/** Stops a replay and shows the text as it is. */
export function settle(element: Element): void {
  playing.get(element)?.abort()
  playing.delete(element)
}
