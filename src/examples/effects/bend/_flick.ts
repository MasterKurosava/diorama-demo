// Scrolls the page down and back, fast enough for bend to read a speed.
export function flick(): void {
  const distance = Math.min(280, innerHeight * 0.3)
  scrollBy({ top: distance, behavior: 'smooth' })
  setTimeout(
    () => scrollBy({ top: -distance, behavior: 'smooth' }),
    360,
  )
}

export function mountFlick(example: HTMLElement): () => void {
  const button =
    example.querySelector<HTMLButtonElement>('[data-flick]')
  button?.addEventListener('click', flick)
  return () => button?.removeEventListener('click', flick)
}
