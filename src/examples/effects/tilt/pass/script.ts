// The link of the example goes nowhere: a click would only jump the page.
export default function mount(example: HTMLElement): () => void {
  const link = example.querySelector('.pass')
  const stop = (e: Event) => e.preventDefault()
  link?.addEventListener('click', stop)
  return () => link?.removeEventListener('click', stop)
}
