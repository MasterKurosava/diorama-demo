// A play button of an example for its <audio>, kept in step with the native controls. Playing one
// example pauses the others on the page, as a page with one player at a time would.
export function player(
  example: HTMLElement,
  button: HTMLButtonElement | null,
): () => void {
  const audio = example.querySelector('audio')
  if (!audio || !button) return () => {}
  // An aria-label such as 'Play Kite Frequency' names the track after the verb.
  const label = (button.getAttribute('aria-label') ?? '').replace(
    /^Play\s*/,
    '',
  )
  const sync = () => {
    const on = !audio.paused && !audio.ended
    button.textContent = on ? 'Pause' : 'Play'
    if (label)
      button.setAttribute(
        'aria-label',
        `${on ? 'Pause' : 'Play'} ${label}`,
      )
  }
  const toggle = () => {
    if (audio.paused || audio.ended) void audio.play().catch(() => {})
    else audio.pause()
  }
  const solo = () => {
    for (const other of document.querySelectorAll('doc-example audio'))
      if (other !== audio) (other as HTMLAudioElement).pause()
  }
  button.addEventListener('click', toggle)
  audio.addEventListener('play', solo)
  for (const type of ['play', 'pause', 'ended'])
    audio.addEventListener(type, sync)
  sync()
  return () => {
    audio.pause()
    button.removeEventListener('click', toggle)
    audio.removeEventListener('play', solo)
    for (const type of ['play', 'pause', 'ended'])
      audio.removeEventListener(type, sync)
  }
}
