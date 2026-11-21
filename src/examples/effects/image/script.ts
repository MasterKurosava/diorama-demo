// Switches the frame of the image with CSS alone: the copy re-measures and follows.
export default function mount(example: HTMLElement): () => void {
  const image = example.querySelector('.astrolabe')
  const buttons = [
    ...example.querySelectorAll<HTMLButtonElement>('[data-frame]'),
  ]
  const frames = buttons.map((b) => b.dataset.frame ?? '')
  const onClick = (e: Event) => {
    const button = e.currentTarget as HTMLButtonElement
    const frame = button.dataset.frame ?? 'fill'
    image?.classList.remove(...frames)
    if (frame !== 'fill') image?.classList.add(frame)
    for (const b of buttons)
      b.setAttribute('aria-pressed', String(b === button))
  }
  for (const b of buttons) b.addEventListener('click', onClick)
  return () => {
    for (const b of buttons) b.removeEventListener('click', onClick)
    image?.classList.remove(...frames)
  }
}
