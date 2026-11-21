// One player at a time: playing this episode pauses the other examples, and leaving the page
// stops it.
export default function mount(example: HTMLElement): () => void {
  const audio = example.querySelector('audio')
  if (!audio) return () => {}
  const solo = () => {
    for (const other of document.querySelectorAll('doc-example audio'))
      if (other !== audio) (other as HTMLAudioElement).pause()
  }
  audio.addEventListener('play', solo)
  return () => {
    audio.pause()
    audio.removeEventListener('play', solo)
  }
}
