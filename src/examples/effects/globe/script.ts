// Names the place under the pointer or in focus, from the globe's dio:marker event.
export default function mount(example: HTMLElement): () => void {
  const globe = example.querySelector('.showrooms')
  const out = example.querySelector('[data-place]')
  const idle = out?.textContent ?? ''
  const onMarker = (e: Event) => {
    const { marker } = (e as CustomEvent<{ marker: Element | null }>)
      .detail
    if (out)
      out.textContent = marker
        ? `Showroom: ${marker.textContent?.trim()}`
        : idle
  }
  globe?.addEventListener('dio:marker', onMarker)
  return () => globe?.removeEventListener('dio:marker', onMarker)
}
