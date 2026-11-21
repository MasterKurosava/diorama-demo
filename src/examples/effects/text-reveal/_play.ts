// Plays a text-reveal again inside an example. The effect plays once on entry and stays shown for
// text already on screen, so a replay drives the copy's presence from 0 to 1 at the effect's own
// pace instead: presence times the whole span is the time since the trigger, so every unit lands
// with its own duration, stagger and delay.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'text-reveal' as never) as unknown as
    | Instance
    | undefined

const graphemes = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
})

/** About as many units as the effect counts: visible letters, words, or line boxes. */
function units(element: Element, by: unknown): number {
  const text = element.textContent ?? ''
  if (by === 'word') return text.split(/\s+/).filter(Boolean).length
  if (by === 'line') {
    const range = document.createRange()
    range.selectNodeContents(element)
    const tops: number[] = []
    for (const r of range.getClientRects())
      if (
        r.width > 0 &&
        !tops.some((t) => Math.abs(t - r.top) < r.height / 2)
      )
        tops.push(r.top)
    return Math.max(1, tops.length)
  }
  return [...graphemes.segment(text)].filter((s) =>
    /\S/.test(s.segment),
  ).length
}

/** Seconds from the trigger until the last unit lands. */
function span(element: Element, p: Record<string, unknown>): number {
  const n = units(element, p.by)
  const last =
    p.motion === 'type'
      ? 1e-3
      : Math.max(Number(p.duration ?? 0.9), 1e-3)
  return (
    Number(p.delay ?? 0) +
    Math.max(0, n - 1) * Number(p.stagger ?? 0.03) +
    last
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
