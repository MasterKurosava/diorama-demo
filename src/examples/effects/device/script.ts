// The phone shows the app; the tablet, the laptop and the browser window show the dashboard made
// for a wide screen, in a box of its shape.
const PHONE = {
  src: '/media/device/tidewell-phone.webp',
  width: '1170',
  height: '2532',
  alt: "The Tidewell app on a phone: today's tide, water temperature and swim window at Pebble Cove",
}
const WIDE = {
  src: '/media/device/tidewell-web.webp',
  width: '2560',
  height: '1600',
  alt: 'The Tidewell dashboard: swimmers per day, beach conditions and the tide at Pebble Cove',
}

export default function mount(example: HTMLElement): () => void {
  const shot = example.querySelector<HTMLImageElement>('img.app-shot')
  const onChange = (e: Event) => {
    const { name, value } = (
      e as CustomEvent<{ name: string; value: unknown }>
    ).detail
    if (name !== 'frame' || !shot) return
    const wide = value !== 'phone'
    const next = wide ? WIDE : PHONE
    shot.classList.toggle('wide', wide)
    if (shot.getAttribute('src') === next.src) return
    shot.width = Number(next.width)
    shot.height = Number(next.height)
    shot.alt = next.alt
    shot.src = next.src
  }
  example.addEventListener('doc-example:change', onChange)
  return () =>
    example.removeEventListener('doc-example:change', onChange)
}
