// Plays blinds again inside an example. The effect opens once on entry and stays open for text
// already on screen, so a replay drives the copy's presence from 0 to 1 at the effect's own pace
// instead: presence times the whole wave is the time since the trigger.
import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

const instanceOf = (element: Element) =>
  app.effects.get(element, 'blinds' as never) as unknown as
    | Instance
    | undefined

/** The lines of the text and the panel they make. */
function panel(element: Element): {
  lines: number
  width: number
  height: number
} {
  const range = document.createRange()
  range.selectNodeContents(element)
  const tops: number[] = []
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const r of range.getClientRects()) {
    if (!r.width) continue
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
    top = Math.min(top, r.top)
    bottom = Math.max(bottom, r.bottom)
    if (!tops.some((t) => Math.abs(t - r.top) < r.height / 2))
      tops.push(r.top)
  }
  const em = Number.parseFloat(getComputedStyle(element).fontSize) || 16
  return {
    lines: Math.max(1, tops.length),
    width: Math.max(1, right - left + 0.28 * em),
    height: Math.max(1, bottom - top),
  }
}

/** The place in the wave of the last slat, as the effect counts it. */
function last(element: Element, p: Record<string, unknown>): number {
  const { lines, width, height } = panel(element)
  const per = Math.max(1, Math.round(Number(p.slats ?? 6)))
  const pitch = height / (per * lines)
  if (p.style === 'vertical')
    return Math.max(2, Math.round(width / (pitch * 2.5))) - 1
  if (p.style === 'tiles') {
    const cols = Math.max(1, Math.round(width / (pitch * 1.5)))
    const rows = Math.max(1, Math.ceil(height / (width / cols) - 0.05))
    return Math.hypot(cols - 0.5, rows - 0.5) - Math.SQRT1_2
  }
  return per * lines - 1
}

/** Seconds from the trigger until the last slat lies flat. */
function span(element: Element, p: Record<string, unknown>): number {
  const duration = Math.max(Number(p.duration ?? 0.9), 0.05)
  const n = last(element, p)
  const gap =
    n > 0
      ? Math.min(
          Math.max(Number(p.stagger ?? 0.07), 0),
          (2.2 * duration) / n,
        )
      : 0
  return Math.max(Number(p.delay ?? 0), 0) + n * gap + duration
}

const playing = new WeakMap<Element, AbortController>()

/** Plays it again, closed for `wait` ms first; false while the effect does not run yet. */
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
