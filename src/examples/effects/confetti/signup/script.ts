// Stands in for the sign-up request: once it answers, the form dispatches the event the confetti
// waits for and says what happened in its status line.
export default function mount(example: HTMLElement): () => void {
  const form = example.querySelector<HTMLFormElement>('.cf-signup')
  const button = form?.querySelector('button')
  const note = form?.querySelector('.cf-note')
  if (!form || !button || !note) return () => {}
  let timer = 0
  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    button.disabled = true
    button.textContent = 'Creating your account'
    timer = window.setTimeout(() => {
      form.dispatchEvent(new Event('signup:done'))
      note.textContent =
        'You are in. Check your inbox to confirm your email.'
      button.disabled = false
      button.textContent = 'Start free trial'
    }, 600)
  }
  form.addEventListener('submit', onSubmit)
  return () => {
    clearTimeout(timer)
    form.removeEventListener('submit', onSubmit)
  }
}
