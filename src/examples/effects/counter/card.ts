import { running } from '../replay.ts'
import { play } from './_play.ts'

// The gallery card: the number is on screen as the preview mounts, so count it once it runs.
export default function mount(card: HTMLElement): void {
  const number = card.querySelector('.gx-live [data-dio="counter"]')
  if (number) void running(number, 'counter').then((ok) => ok && play(number))
}
