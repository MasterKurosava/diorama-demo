// Breaks a shatter heading as if it were clicked at a share of its width, without a click that
// bubbles: the gallery card sits inside a link.
export function strike(element: Element, at = 0.35): void {
  const r = element.getBoundingClientRect()
  element.dispatchEvent(
    new MouseEvent('click', {
      clientX: r.left + r.width * at,
      clientY: r.top + r.height * 0.5,
      detail: 1,
    }),
  )
}
