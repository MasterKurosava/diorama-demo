import { onScreen, running } from '../../replay.ts'
import { play, settle } from '../_play.ts'

// Types the command again on Replay, and once if it was on screen when the page opened.
export default function mount(example: HTMLElement): () => void {
  const command = example.querySelector('.ex-root [data-dio]')
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  if (!command) return () => {}
  const again = () => play(command)
  button?.addEventListener('click', again)
  if (onScreen(command))
    void running(command, 'text-reveal').then((ok) => ok && again())
  return () => {
    button?.removeEventListener('click', again)
    settle(command)
  }
}
