import { app } from '../../docs/diorama.ts'

export default (example: HTMLElement) => {
  const mono = app.attach('.gallery img', 'mono', { strength: 1 })

  const slider = example.querySelector('.strength')
  if (slider instanceof HTMLInputElement) {
    slider.addEventListener('input', () => {
      mono.params.strength = slider.valueAsNumber
    })
  }
  // The docs page goes away with its gallery; a site keeps the handle for good.
  return () => mono()
}
