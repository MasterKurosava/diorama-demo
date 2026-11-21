// When the notice has blown away the page removes it; a button brings a fresh one back.
export default function mount(example: HTMLElement): () => void {
  const slot = example.querySelector('.du-slot')
  const again = example.querySelector<HTMLButtonElement>('.du-again')
  const fresh = slot?.querySelector('.du-toast')?.cloneNode(true) as
    | Element
    | undefined
  if (!slot || !again || !fresh) return () => {}
  const gone = (e: Event) => {
    ;(e.target as Element).closest('.du-toast')?.remove()
    again.hidden = false
    again.focus()
  }
  const restore = () => {
    const toast = fresh.cloneNode(true) as Element
    for (const el of toast.querySelectorAll(
      '[data-dio-state], [data-dio-dust]',
    )) {
      el.removeAttribute('data-dio-state')
      el.removeAttribute('data-dio-dust')
    }
    slot.append(toast)
    again.hidden = true
  }
  slot.addEventListener('dio:dust', gone)
  again.addEventListener('click', restore)
  return () => {
    slot.removeEventListener('dio:dust', gone)
    again.removeEventListener('click', restore)
  }
}
