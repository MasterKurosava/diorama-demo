import { running } from '../replay.ts'
import { play } from './_play.ts'

// The gallery card: the text is on screen as the preview mounts, so gather it once it runs.
export default function mount(card: HTMLElement): void {
  const text = card.querySelector('.gx-live [data-dio="assemble"]')
  if (text) void running(text, 'assemble').then((ok) => ok && play(text))
}
