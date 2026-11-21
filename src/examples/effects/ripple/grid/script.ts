// The links of the example go nowhere: a click would only jump the page.
export default function mount(example: HTMLElement): () => void {
  const stop = (e: Event) => e.preventDefault()
  const links = [...example.querySelectorAll('.works a')]
  for (const a of links) a.addEventListener('click', stop)
  return () => {
    for (const a of links) a.removeEventListener('click', stop)
  }
}
