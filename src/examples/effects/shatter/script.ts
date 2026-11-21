import { running } from '../replay.ts'
import { strike } from './_strike.ts'

// Click the heading to break it where the pointer is; the button and a changed switch or slider
// break it too, once the effect runs with the new value.
export default function mount(example: HTMLElement): () => void {
  const heading = example.querySelector('.sh-headline')
  const button =
    example.querySelector<HTMLButtonElement>('[data-break]')
  if (!heading) return () => {}
  let timer = 0
  const again = () => strike(heading)
  const onChange = (e: Event) => {
    const { rebuild } = (e as CustomEvent<{ rebuild: boolean }>).detail
    clearTimeout(timer)
    if (rebuild)
      void running(heading, 'shatter').then((ok) => {
        if (ok) timer = window.setTimeout(again, 400)
      })
    else timer = window.setTimeout(again, 300)
  }
  example.addEventListener('doc-example:change', onChange)
  button?.addEventListener('click', again)
  return () => {
    clearTimeout(timer)
    example.removeEventListener('doc-example:change', onChange)
    button?.removeEventListener('click', again)
  }
}
