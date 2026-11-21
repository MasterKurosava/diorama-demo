// Names the cafe under the pointer or in focus, from the map's dio:marker event.
export default function mount(example: HTMLElement): () => void {
  const map = example.querySelector('.cafes')
  const out = example.querySelector('[data-place]')
  const idle = out?.textContent ?? ''
  const onMarker = (e: Event) => {
    const { marker } = (e as CustomEvent<{ marker: Element | null }>)
      .detail
    if (out)
      out.textContent = marker
        ? `Cafe: ${marker.textContent?.trim()}`
        : idle
  }
  map?.addEventListener('dio:marker', onMarker)
  return () => map?.removeEventListener('dio:marker', onMarker)
}
