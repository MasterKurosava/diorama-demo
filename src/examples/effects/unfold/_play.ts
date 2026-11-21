// Plays an unfold again inside an example. The effect opens once on entry and stays flat for text
// already on screen, so a replay drives the copy's presence from 0 to 1 at the effect's own pace
// instead: presence times the whole span is the time since the trigger.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'unfold' as never) as unknown as
    | Instance
    | undefined

const graphemes = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
})

/** The line boxes of the text and the width they span. */
function lines(element: Element): {
  count: number
  width: number
  height: number
} {
  const range = document.createRange()
  range.selectNodeContents(element)
  const tops: number[] = []
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let height = 0
  for (const r of range.getClientRects()) {
    if (!r.width) continue
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
    height = Math.max(height, r.height)
    if (!tops.some((t) => Math.abs(t - r.top) < r.height / 2))
      tops.push(r.top)
  }
  return {
    count: Math.max(1, tops.length),
    width: Math.max(0, right - left),
    height,
  }
}

/** About as many units as the effect opens one after another. */
function units(element: Element, p: Record<string, unknown>): number {
  // 'auto' (the default) is 0 here: the effect picks the cut.
  const bands =
    p.bands === 'auto' || p.bands === undefined
      ? 0
      : Math.max(1, Math.round(Number(p.bands)))
  const em = Number.parseFloat(getComputedStyle(element).fontSize) || 16
  const { count, width, height } = lines(element)
  if (p.style === 'cards')
    return [...graphemes.segment(element.textContent ?? '')].filter(
      (s) => /\S/.test(s.segment),
    ).length
  if (p.style === 'accordion') {
    const panels =
      bands ||
      Math.max(4, Math.min(24, 2 * Math.round(width / (em * 1.8))))
    return Math.ceil(panels / 2)
  }
  if (p.style === 'origami') {
    const rows = bands || count
    const side = (count * height) / rows || em
    return rows * 4 * Math.max(1, Math.ceil(width / side - 0.05))
  }
  return (bands || (count < 2 ? 3 : count)) - 1
}

/** Seconds from the trigger until the last unit lies flat. */
function span(element: Element, p: Record<string, unknown>): number {
  const n = units(element, p)
  const duration = Math.max(Number(p.duration ?? 0.9), 0.05)
  const spread = p.style === 'accordion' ? 0.45 : 1.4
  const gap =
    n > 1
      ? Math.min(
          Number(p.stagger ?? 0.3),
          (duration * spread) / (n - 1),
        )
      : 0
  return Number(p.delay ?? 0) + Math.max(0, n - 1) * gap + duration
}

const playing = new WeakMap<Element, AbortController>()

/** Plays it again, folded for `wait` ms first; false while the effect does not run yet. */
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
