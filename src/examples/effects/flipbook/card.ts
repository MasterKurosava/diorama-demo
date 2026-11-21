import { app } from '../../../docs/diorama.ts'

interface Book {
  set(values: { index: number }): void
}

// The gallery card turns the menu's spreads in a loop: the cover, pages 2 and 3, pages 4 and 5.
export default function mount(card: HTMLElement): () => void {
  const box = card.querySelector('.gx-live [data-dio]')
  const spreads = [0, 1, 3, 1]
  let at = 0
  const timer = window.setInterval(() => {
    at = (at + 1) % spreads.length
    const book = box && (app.effects.get(box, 'flipbook' as never) as unknown as Book | undefined)
    book?.set({ index: spreads[at] ?? 0 })
  }, 1800)
  return () => clearInterval(timer)
}
