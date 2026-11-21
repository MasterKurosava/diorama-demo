import { app } from '../../../../docs/diorama.ts'

// The button tweens `position` from 0 to 1 and back; by="manual" leaves the scroll out of it.
export default function mount(example: HTMLElement): () => void {
  const image = example.querySelector('.cover img')
  const button = example.querySelector<HTMLButtonElement>('.open')
  let raf = 0
  const toggle = () => {
    const expand = image && app.effects.get(image, 'expand')
    if (!expand || !button) return
    const open = button.getAttribute('aria-pressed') !== 'true'
    button.setAttribute('aria-pressed', String(open))
    button.textContent = open ? 'Back to the card' : 'View full frame'
    cancelAnimationFrame(raf)
    const from = expand.params.position
    const to = open ? 1 : 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700)
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
      expand.params.position = from + (to - from) * eased
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }
  button?.addEventListener('click', toggle)
  return () => {
    cancelAnimationFrame(raf)
    button?.removeEventListener('click', toggle)
  }
}
