// The like button keeps its own job: every tap counts, and the hearts float up over the stream.
export default function mount(example: HTMLElement): () => void {
  const like = example.querySelector<HTMLButtonElement>('.ej-like')
  const count = like?.querySelector('.ej-count')
  if (!like || !count) return () => {}
  const onLike = () => {
    like.setAttribute('aria-pressed', 'true')
    count.textContent = String(Number(count.textContent) + 1)
  }
  like.addEventListener('click', onLike)
  return () => like.removeEventListener('click', onLike)
}
