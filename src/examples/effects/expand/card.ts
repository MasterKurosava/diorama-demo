import { app } from '../../../docs/diorama.ts'
import { running } from '../replay.ts'

// The card holds still in the grid, so it opens the picture to the card and folds it back in turn.
export default function mount(card: HTMLElement): () => void {
  const image = card.querySelector('.gx-live img')
  let frame = 0
  let stop = false
  if (image)
    void running(image, 'expand').then((ok) => {
      const handle = app.effects.get(image, 'expand')
      if (!ok || !handle) return
      const start = performance.now()
      const step = (now: number) => {
        if (stop) return
        // Open over 1.4 s, hold, fold back, hold: a 4 s loop.
        const t = ((now - start) / 4000) % 1
        const open = t < 0.35 ? t / 0.35 : t < 0.5 ? 1 : t < 0.85 ? 1 - (t - 0.5) / 0.35 : 0
        handle.params.position = open < 0.5 ? 2 * open * open : 1 - (-2 * open + 2) ** 2 / 2
        frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    })
  return () => {
    stop = true
    cancelAnimationFrame(frame)
  }
}
