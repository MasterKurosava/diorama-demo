import { app } from '../../../../docs/diorama.ts'

// Completing the last lesson fills the bar and fires the fireworks through the manual trigger.
export default function mount(example: HTMLElement): () => void {
  const course = example.querySelector<HTMLElement>('.cf-course')
  const button = course?.querySelector('button')
  const said = course?.querySelector('.cf-said')
  const reset = example.querySelector<HTMLButtonElement>('[data-reset]')
  if (!course || !button || !said) return () => {}
  const onDone = () => {
    const confetti = app.effects.get(course, 'confetti')
    if (confetti) confetti.params.fire++
    course.style.setProperty('--done', '1')
    button.disabled = true
    button.textContent = 'Completed'
    said.textContent =
      'Course complete. Your certificate is ready to download.'
  }
  const onReset = () => {
    course.style.removeProperty('--done')
    button.disabled = false
    button.textContent = 'Mark as complete'
    said.textContent = ''
  }
  button.addEventListener('click', onDone)
  reset?.addEventListener('click', onReset)
  return () => {
    button.removeEventListener('click', onDone)
    reset?.removeEventListener('click', onReset)
  }
}
