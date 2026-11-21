import { app } from '../../../docs/diorama.ts'
import { running } from '../replay.ts'

// The gallery card: one burst from the label once the preview runs. The card is a link, so the
// burst is fired by the manual trigger rather than by a click.
export default function mount(card: HTMLElement): void {
  const label = card.querySelector('.gx-live [data-dio="confetti"]')
  if (!label) return
  void running(label, 'confetti').then((ok) => {
    const confetti = ok ? app.effects.get(label, 'confetti') : undefined
    if (confetti) confetti.params.fire++
  })
}
