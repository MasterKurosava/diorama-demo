// What a component does when its `active` prop changes: it writes the attribute.
export default (example: HTMLElement) => {
  const img = example.querySelector('img')
  const active = example.querySelector<HTMLInputElement>('.active')
  const onChange = () =>
    img?.setAttribute('data-dio-strength', active?.checked ? '2' : '1')
  active?.addEventListener('change', onChange)
  return () => active?.removeEventListener('change', onChange)
}
