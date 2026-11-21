// 08 Dawn. Scroll drives the closing scene's hour from midnight to sunrise through a live param.
import type { App } from 'dioramajs'

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

export function mount(app: App): () => void {
  const room = document.querySelector<HTMLElement>('.dawn')
  const sky = document.querySelector<HTMLElement>('.dawn-sky')
  if (!room || !sky) return () => {}
  let frame = 0
  const follow = (): void => {
    frame = 0
    const r = room.getBoundingClientRect()
    // 0 when the room enters the viewport, 1 at its last screen.
    const p = (window.innerHeight - r.top) / Math.max(1, r.height)
    const hour = 0.5 + 0.5 * smooth((p - 0.25) / 0.55)
    const instance = app.effects?.get(sky, 'scene')
    if (instance) instance.params.hour = hour
    else sky.setAttribute('data-dio-hour', hour.toFixed(3))
  }
  const queue = (): void => {
    if (!frame) frame = requestAnimationFrame(follow)
  }
  addEventListener('scroll', queue, { passive: true })
  addEventListener('resize', queue)
  queue()
  return () => {
    cancelAnimationFrame(frame)
    removeEventListener('scroll', queue)
    removeEventListener('resize', queue)
  }
}
