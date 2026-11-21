// The page counter under the book: "Cover", "Pages 2 and 3 of 6", "Page 6 of 6".
export default function mount(example: HTMLElement): () => void {
  const book = example.querySelector<HTMLElement>('.menu')
  const out = example.querySelector('[data-pages]')
  if (!book || !out) return () => {}
  const n = book.querySelectorAll('img').length
  const onIndex = (e: Event) => {
    const { index } = (e as CustomEvent<{ index: number }>).detail
    // auto spreads show two pages when the box is at least 1.5 page widths wide (3 by 4 pages).
    const double = book.clientWidth >= 1.125 * book.clientHeight
    const last =
      double && index > 0 ? Math.min(index + 2, n) : index + 1
    out.textContent =
      index === 0
        ? 'Cover'
        : last > index + 1
          ? `Pages ${index + 1} and ${last} of ${n}`
          : `Page ${index + 1} of ${n}`
  }
  book.addEventListener('dio:index', onIndex)
  return () => book.removeEventListener('dio:index', onIndex)
}
