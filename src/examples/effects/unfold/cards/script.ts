import { onScreen, running } from '../../replay.ts'
import { play, settle } from '../_play.ts'

// Plays the heading again after a slider rests, and once if it was on screen at load.
export default function mount(example: HTMLElement): () => void {
  const heading = example.querySelector('[data-dio="unfold"]')
  if (!heading) return () => {}
  let timer = 0
  const onChange = () => {
    clearTimeout(timer)
    // A switch or `bands` rebuilds the effect: wait until it runs again.
    timer = window.setTimeout(
      () =>
        void running(heading, 'unfold').then(
          (ok) => ok && play(heading),
        ),
      300,
    )
  }
  example.addEventListener('doc-example:change', onChange)
  if (onScreen(heading))
    void running(heading, 'unfold').then((ok) => ok && play(heading))
  return () => {
    clearTimeout(timer)
    settle(heading)
    example.removeEventListener('doc-example:change', onChange)
  }
}
