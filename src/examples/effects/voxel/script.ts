import { onScreen, running } from '../replay.ts'
import { play, settle } from './_play.ts'

// The heading never leaves the screen here, so the example builds it again after a change.
export default function mount(example: HTMLElement): () => void {
  const heading = example.querySelector('.vx-title')
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  if (!heading) return () => {}
  let timer = 0
  const again = () => play(heading)
  const onChange = (e: Event) => {
    const { rebuild } = (e as CustomEvent<{ rebuild: boolean }>).detail
    clearTimeout(timer)
    // A switch rebuilds, so the replay waits for it; a slider plays once it rests.
    if (rebuild) play(heading, 400)
    else timer = window.setTimeout(again, 300)
  }
  example.addEventListener('doc-example:change', onChange)
  button?.addEventListener('click', again)
  // On screen when the page opened, so it stays shown: build it once when it is ready.
  if (onScreen(heading))
    void running(heading, 'voxel').then((ok) => ok && again())
  return () => {
    clearTimeout(timer)
    settle(heading)
    example.removeEventListener('doc-example:change', onChange)
    button?.removeEventListener('click', again)
  }
}
