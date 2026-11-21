import { running } from '../replay.ts'
import { play, settle } from './_play.ts'

// The heading blows away as it leaves the top of the window; the button plays it in place.
export default function mount(example: HTMLElement): () => void {
  const heading = example.querySelector('.du-headline')
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  if (!heading) return () => {}
  let timer = 0
  const again = () => play(heading)
  const onChange = (e: Event) => {
    const { rebuild } = (e as CustomEvent<{ rebuild: boolean }>).detail
    clearTimeout(timer)
    // A switch rebuilds, so the replay waits for it; a slider plays once it rests.
    if (rebuild)
      void running(heading, 'dust').then(
        (ok) => ok && play(heading, 400),
      )
    else timer = window.setTimeout(again, 300)
  }
  example.addEventListener('doc-example:change', onChange)
  button?.addEventListener('click', again)
  return () => {
    clearTimeout(timer)
    settle(heading)
    example.removeEventListener('doc-example:change', onChange)
    button?.removeEventListener('click', again)
  }
}
