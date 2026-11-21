import { app } from '../../../docs/diorama.ts'

interface Stack {
  readonly params: { index: number }
  set(values: { index: number }): void
}

// Previous and Next under the pile, and the name of the place on top.
export default function mount(example: HTMLElement): () => void {
  const deck = example.querySelector<HTMLElement>('.trips')
  if (!deck) return () => {}
  const cards = [...deck.querySelectorAll('img')]
  const caption = example.querySelector('[data-caption]')
  const stack = () =>
    app.effects.get(deck, 'stack' as never) as unknown as
      | Stack
      | undefined
  const onClick = (e: MouseEvent) => {
    const button = (e.target as Element).closest<HTMLElement>(
      '[data-step]',
    )
    if (!button) return
    const s = stack()
    if (s)
      return s.set({
        index: Math.round(s.params.index) + Number(button.dataset.step),
      })
    deck.scrollBy({
      left: Number(button.dataset.step) * deck.clientWidth,
      behavior: 'smooth',
    })
  }
  // The caption is the part of the alt text before its colon: "The headland".
  const onIndex = (e: Event) => {
    const index = (e as CustomEvent<{ index: number }>).detail.index
    if (caption)
      caption.textContent =
        (cards[index]?.alt ?? '').split(':')[0] ?? ''
  }
  example.addEventListener('click', onClick)
  deck.addEventListener('dio:index', onIndex)
  return () => {
    example.removeEventListener('click', onClick)
    deck.removeEventListener('dio:index', onIndex)
  }
}
