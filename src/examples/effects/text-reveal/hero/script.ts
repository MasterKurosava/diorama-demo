import { onScreen, running } from '../../replay.ts'
import { play, settle } from '../_play.ts'

// Plays the headline and its subline again on Replay, and once if they were on screen at load.
export default function mount(example: HTMLElement): () => void {
  const texts = [...example.querySelectorAll('.ex-root [data-dio]')]
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  const again = () => {
    for (const text of texts) play(text)
  }
  button?.addEventListener('click', again)
  const first = texts[0]
  if (first && onScreen(first))
    void Promise.all(texts.map((t) => running(t, 'text-reveal'))).then(
      (ok) => ok.every(Boolean) && again(),
    )
  return () => {
    button?.removeEventListener('click', again)
    for (const text of texts) settle(text)
  }
}
