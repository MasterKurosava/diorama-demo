import { app } from '../../docs/diorama.ts'

// The checkbox stands in for the Rendering panel of DevTools: it writes the setting Diorama reads
// from prefers-reduced-motion, for the whole docs page, until the example goes away.
export default (example: HTMLElement) => {
  const setting = app.stage.reducedMotion as unknown as {
    value: boolean
  }
  const system = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  const toggle = example.querySelector<HTMLInputElement>('.reduce')
  const onChange = () => {
    setting.value = toggle?.checked ?? false
  }
  toggle?.addEventListener('change', onChange)
  return () => {
    toggle?.removeEventListener('change', onChange)
    setting.value = system
  }
}
