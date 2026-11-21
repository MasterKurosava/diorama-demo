// Controls outside a gallery, since its copy covers the whole box: buttons with data-step or
// data-show, an output with data-count, a caption with data-caption and thumbnails that get
// aria-current. Without WebGL the buttons scroll the strip instead.
import { app } from '../../../docs/diorama.ts'

interface Gallery {
  readonly params: { index: number }
  set(values: { index: number }): void
}

export function pager(
  example: HTMLElement,
  box: HTMLElement,
): () => void {
  const pictures = [...box.querySelectorAll('img')]
  const n = pictures.length
  const count = example.querySelector('[data-count]')
  const caption = example.querySelector('[data-caption]')
  const thumbs = [
    ...example.querySelectorAll<HTMLElement>('[data-show]'),
  ]
  const gallery = () =>
    app.effects.get(box, 'gallery' as never) as unknown as
      | Gallery
      | undefined

  const shown = (index: number) => {
    if (count) count.textContent = `${index + 1} / ${n}`
    // The caption is the part of the alt text before its colon: "The Garden Room".
    if (caption)
      caption.textContent =
        (pictures[index]?.alt ?? '').split(':')[0] ?? ''
    for (const t of thumbs)
      t.setAttribute(
        'aria-current',
        String(Number(t.dataset.show) === index),
      )
  }
  const onClick = (e: MouseEvent) => {
    const button = (e.target as Element).closest<HTMLElement>(
      '[data-step], [data-show]',
    )
    if (!button) return
    const g = gallery()
    const at = Math.round(
      g?.params.index ?? box.scrollLeft / Math.max(box.clientWidth, 1),
    )
    const index =
      button.dataset.show === undefined
        ? at + Number(button.dataset.step)
        : Number(button.dataset.show)
    if (g) return g.set({ index })
    const i = ((index % n) + n) % n
    box.scrollTo({ left: i * box.clientWidth, behavior: 'smooth' })
    shown(i)
  }
  const onIndex = (e: Event) =>
    shown((e as CustomEvent<{ index: number }>).detail.index)
  example.addEventListener('click', onClick)
  box.addEventListener('dio:index', onIndex)
  shown(0)
  return () => {
    example.removeEventListener('click', onClick)
    box.removeEventListener('dio:index', onIndex)
  }
}
