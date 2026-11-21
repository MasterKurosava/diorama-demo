// The title of the book in the middle, from the part of its alt text before " by".
export default function mount(example: HTMLElement): () => void {
  const shelf = example.querySelector('.shelf')
  const title = example.querySelector('.shelf-title')
  if (!shelf || !title) return () => {}
  const names = [...shelf.querySelectorAll('img')].map(
    (img) => img.alt.split(' by ')[0] ?? '',
  )
  const onIndex = (e: Event) => {
    title.textContent =
      names[(e as CustomEvent<{ index: number }>).detail.index] ?? ''
  }
  shelf.addEventListener('dio:index', onIndex)
  return () => shelf.removeEventListener('dio:index', onIndex)
}
