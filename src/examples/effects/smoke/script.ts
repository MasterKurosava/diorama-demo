import { running } from '../replay.ts'
import { play, settle } from './_play.ts'

// The heading condenses once on its own; the button and every change play it again in place.
export default function mount(example: HTMLElement): () => void {
  const heading = example.querySelector('.sm-headline')
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
      void running(heading, 'smoke').then(
        (ok) => ok && play(heading, 300),
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
