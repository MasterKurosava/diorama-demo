// Palette buttons write the four colors through the example's own color inputs, so the colors
// reach the effect and the code below the way a picked color does.
export default function mount(example: HTMLElement): () => void {
  const buttons = [
    ...example.querySelectorAll<HTMLButtonElement>('[data-palette]'),
  ]
  const inputs = [1, 2, 3, 4].map((n) =>
    example.querySelector<HTMLInputElement>(
      `[data-param="color${n}"] input`,
    ),
  )
  const press = (on?: HTMLButtonElement) => {
    for (const b of buttons)
      b.setAttribute('aria-pressed', String(b === on))
  }
  const onClick = (e: MouseEvent) => {
    const button = (e.target as Element).closest<HTMLButtonElement>(
      '[data-palette]',
    )
    if (!button) return
    const colors = (button.dataset.palette ?? '').split(' ')
    inputs.forEach((input, i) => {
      const color = colors[i]
      if (!input || !color || input.value === color) return
      input.value = color
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    press(button)
  }
  // A color picked by hand leaves the palettes.
  const onPick = (e: Event) => {
    if (
      e.isTrusted &&
      (e.target as Element).closest('[data-param^="color"]')
    )
      press()
  }
  example.addEventListener('click', onClick)
  example.addEventListener('input', onPick)
  return () => {
    example.removeEventListener('click', onClick)
    example.removeEventListener('input', onPick)
  }
}
