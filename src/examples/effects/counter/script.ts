import { onScreen, running } from '../replay.ts'
import { play, settle } from './_play.ts'

// The number never leaves the screen here, so the example counts it again after a change.
export default function mount(example: HTMLElement): () => void {
  const number = example.querySelector('.cn-number')
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  if (!number) return () => {}
  let timer = 0
  const again = () => play(number)
  const onChange = (e: Event) => {
    const { rebuild } = (e as CustomEvent<{ rebuild: boolean }>).detail
    clearTimeout(timer)
    // A switch rebuilds, so the replay waits for it; a slider plays once it rests.
    if (rebuild) play(number, 400)
    else timer = window.setTimeout(again, 300)
  }
  example.addEventListener('doc-example:change', onChange)
  button?.addEventListener('click', again)
  // On screen when the page opened, so it stays shown: count it once when it is ready.
  if (onScreen(number))
    void running(number, 'counter').then((ok) => ok && again())
  return () => {
    clearTimeout(timer)
    settle(number)
    example.removeEventListener('doc-example:change', onChange)
    button?.removeEventListener('click', again)
  }
}
