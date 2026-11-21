// The project pages do not exist on this site: a click on a name stays on the page.
export default function mount(example: HTMLElement): () => void {
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('.ex-root a')) e.preventDefault()
  }
  example.addEventListener('click', onClick)
  return () => example.removeEventListener('click', onClick)
}
