import { app } from '../../../../docs/diorama.ts'

interface Gallery {
  set(values: { interval: number }): void
}

// The pause button turns the interval timer off and on again, as the recipe on the page shows.
export default function mount(example: HTMLElement): () => void {
  const house = example.querySelector('.house')
  const pause = example.querySelector<HTMLButtonElement>('.house-pause')
  if (!house || !pause) return () => {}
  const onClick = () => {
    const gallery = app.effects.get(
      house,
      'gallery' as never,
    ) as unknown as Gallery | undefined
    const paused = pause.getAttribute('aria-pressed') === 'true'
    gallery?.set({ interval: paused ? 5 : 0 })
    pause.setAttribute('aria-pressed', String(!paused))
  }
  pause.addEventListener('click', onClick)
  return () => pause.removeEventListener('click', onClick)
}
