// The gallery card plays the muted film while it is under the pointer, so the light moves.
export default function mount(card: HTMLElement): () => void {
  const video = card.querySelector<HTMLVideoElement>('.gx-live video')
  void video?.play().catch(() => {})
  return () => video?.pause()
}
