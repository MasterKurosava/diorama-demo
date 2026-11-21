// 02 Map. One class on .topo moves the links between three layouts and the relief follows.
const LAYOUTS = [
  { name: 'Massif', className: '' },
  { name: 'Range', className: 'range' },
  { name: 'Ring', className: 'ring' },
] as const

export function mount(): () => void {
  const map = document.querySelector<HTMLElement>('.topo')
  const button = document.querySelector<HTMLButtonElement>('[data-layout]')
  const state = button?.querySelector<HTMLElement>('.atlas-state')
  if (!map || !button) return () => {}
  let current = 0
  const next = (): void => {
    const from = LAYOUTS[current]
    current = (current + 1) % LAYOUTS.length
    const to = LAYOUTS[current]
    if (from?.className) map.classList.remove(from.className)
    if (to?.className) map.classList.add(to.className)
    if (state && to) state.textContent = to.name
  }
  button.addEventListener('click', next)
  return () => button.removeEventListener('click', next)
}
