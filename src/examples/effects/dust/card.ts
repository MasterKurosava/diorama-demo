import { running } from '../replay.ts'
import { play } from './_play.ts'

// The gallery card: the text is on screen as the preview mounts, so blow it away and back once it runs.
export default function mount(card: HTMLElement): void {
  const text = card.querySelector('.gx-live [data-dio="dust"]')
  if (text) void running(text, 'dust').then((ok) => ok && play(text, 300))
}
