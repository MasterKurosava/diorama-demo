import { running } from '../replay.ts'
import { strike } from './_strike.ts'

// The gallery card: break the word once the preview runs, and again every few seconds.
export default function mount(card: HTMLElement): () => void {
  const text = card.querySelector('.gx-live [data-dio="shatter"]')
  let timer = 0
  if (text)
    void running(text, 'shatter').then((ok) => {
      if (!ok) return
      strike(text)
      timer = window.setInterval(() => text.isConnected && strike(text), 4200)
    })
  return () => clearInterval(timer)
}
