import { app } from '../../../docs/diorama.ts'

interface Gallery {
  readonly params: { index: number }
  set(values: { index: number }): void
}

// The gallery card: auto pauses under the pointer, so the card pages on a timer of its own.
export default function mount(card: HTMLElement): () => void {
  const box = card.querySelector('.gx-live [data-dio]')
  const timer = window.setInterval(() => {
    const gallery =
      box && (app.effects.get(box, 'gallery' as never) as unknown as Gallery | undefined)
    gallery?.set({ index: Math.round(gallery.params.index) + 1 })
  }, 1700)
  return () => clearInterval(timer)
}
