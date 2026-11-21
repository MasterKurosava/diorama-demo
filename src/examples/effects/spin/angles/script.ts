import { app } from '../../../../docs/diorama.ts'

// Each button turns the camera to its frame the short way round, one frame at a time.
export default function mount(example: HTMLElement): () => void {
  const camera = example.querySelector('.camera')
  const views = example.querySelector('.views')
  const count = 36
  let raf = 0
  const turnTo = (target: number) => {
    const spin = camera && app.effects.get(camera, 'spin')
    if (!spin) return
    cancelAnimationFrame(raf)
    const from = spin.params.frame
    // The shorter way round the circle.
    const delta =
      ((((target - from) % count) + count * 1.5) % count) - count / 2
    const start = performance.now()
    const duration = 120 + Math.abs(delta) * 30
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      spin.params.frame =
        ((Math.round(from + delta * eased) % count) + count) % count
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }
  const onClick = (e: Event) => {
    const button = (e.target as Element).closest<HTMLButtonElement>(
      'button[data-frame]',
    )
    if (button) turnTo(Number(button.dataset.frame))
  }
  views?.addEventListener('click', onClick)
  return () => {
    cancelAnimationFrame(raf)
    views?.removeEventListener('click', onClick)
  }
}
