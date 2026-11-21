import { transition } from 'dioramajs'
import { app } from '../../docs/diorama.ts'

// src/main.ts of this step, with the box and templates looked up inside the example.
export default (example: HTMLElement) => {
  const box = example.querySelector('.box')
  if (!box) return
  const onClick = (event: Event) => {
    const link =
      event.target instanceof Element ? event.target.closest('a') : null
    const page = link && example.querySelector(`template${link.hash}`)
    if (!(page instanceof HTMLTemplateElement)) return
    event.preventDefault()
    transition(app, () =>
      box.replaceChildren(page.content.cloneNode(true)),
    )
  }
  box.addEventListener('click', onClick)
  return () => box.removeEventListener('click', onClick)
}
