import { app } from '../../../docs/diorama.ts'
import { running } from '../replay.ts'

// The card holds still in the grid, so it scrubs the film back and forth while it is shown.
export default function mount(card: HTMLElement): () => void {
  const watch = card.querySelector('.gx-live .watch')
  let frame = 0
  let stop = false
  if (watch)
    void running(watch, 'scrub').then((ok) => {
      const handle = app.effects.get(watch, 'scrub')
      if (!ok || !handle) return
      const start = performance.now()
      const step = (now: number) => {
        if (stop) return
        // Out over 2.4 s, back over 2.4 s.
        const t = ((now - start) / 2400) % 2
        handle.params.position = t < 1 ? t : 2 - t
        frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    })
  return () => {
    stop = true
    cancelAnimationFrame(frame)
  }
}
