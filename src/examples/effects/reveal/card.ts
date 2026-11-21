import { replay, running } from '../replay.ts'

// The gallery card: the image is on screen as the preview mounts, so play the reveal once it runs.
export default function mount(card: HTMLElement): void {
  const image = card.querySelector('.gx-live img')
  if (image) void running(image, 'reveal').then((ok) => ok && replay(image, 'reveal'))
}
