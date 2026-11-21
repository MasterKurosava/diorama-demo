import { onScreen, replay, running, settle } from '../replay.ts'

// The image never leaves the screen here, so the example plays the reveal again after a change.
export default function mount(example: HTMLElement): () => void {
  const image = example.querySelector('.ridges')
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  if (!image) return () => {}
  let timer = 0
  const again = () => replay(image, 'reveal')
  const onChange = (e: Event) => {
    const { name, rebuild } = (
      e as CustomEvent<{ name: string; rebuild: boolean }>
    ).detail
    clearTimeout(timer)
    // Scroll mode follows the page instead; a switch rebuilds, a slider plays once it rests.
    if (name === 'mode') settle(image)
    else if (rebuild) replay(image, 'reveal', { wait: 400 })
    else timer = window.setTimeout(again, 300)
  }
  example.addEventListener('doc-example:change', onChange)
  button?.addEventListener('click', again)
  // On screen when the page opened, so it stays shown: play it once when it is ready.
  if (onScreen(image))
    void running(image, 'reveal').then((ok) => ok && again())
  return () => {
    clearTimeout(timer)
    settle(image)
    example.removeEventListener('doc-example:change', onChange)
    button?.removeEventListener('click', again)
  }
}
