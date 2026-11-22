// Phones and windows narrower than a tablet get a note instead of the site (Small.astro): the
// scene is built for a wide screen and a mouse. The engine does not boot under the note, and the
// page reloads when the window crosses the line, so it comes back with or without its effects.
// The same query is written out in the note's CSS.
export const SMALL = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)'

/** True on a screen that gets the note. */
export const small = (): boolean => typeof matchMedia === 'function' && matchMedia(SMALL).matches

if (typeof matchMedia === 'function') {
  matchMedia(SMALL).addEventListener('change', () => location.reload())
  // Copies the address for a bigger screen.
  document.addEventListener('click', (e) => {
    const button = (e.target as Element | null)?.closest<HTMLButtonElement>('.small-copy')
    if (!button) return
    void navigator.clipboard?.writeText(location.href).then(() => {
      button.dataset.done = ''
      setTimeout(() => delete button.dataset.done, 2000)
    })
  })
}
