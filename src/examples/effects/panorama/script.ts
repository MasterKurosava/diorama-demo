// Names the hotspot under the pointer or in focus, from the panorama's dio:marker event.
export default function mount(example: HTMLElement): () => void {
  const room = example.querySelector('.lounge')
  const out = example.querySelector('[data-spot]')
  const idle = out?.textContent ?? ''
  const onMarker = (e: Event) => {
    const { marker } = (e as CustomEvent<{ marker: Element | null }>)
      .detail
    if (out)
      out.textContent = marker ? `Hotspot: ${marker.textContent}` : idle
  }
  room?.addEventListener('dio:marker', onMarker)
  return () => room?.removeEventListener('dio:marker', onMarker)
}
