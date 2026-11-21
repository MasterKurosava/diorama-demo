import { onScreen, replay, running, settle } from '../../replay.ts'

// Plays the cascade again on Replay, and once if the grid was on screen when the page opened.
export default function mount(example: HTMLElement): () => void {
  const prints = [...example.querySelectorAll('.prints img')]
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  const again = () => {
    for (const print of prints) replay(print, 'reveal')
  }
  button?.addEventListener('click', again)
  const first = prints[0]
  if (first && onScreen(first))
    void Promise.all(prints.map((p) => running(p, 'reveal'))).then(
      (ok) => ok.every(Boolean) && again(),
    )
  return () => {
    button?.removeEventListener('click', again)
    for (const print of prints) settle(print)
  }
}
