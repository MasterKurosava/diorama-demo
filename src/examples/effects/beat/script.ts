import { player } from '../visualizer/_player.ts'

// Play in the panel drives the <audio> next to the cover.
export default function mount(example: HTMLElement): () => void {
  return player(
    example,
    example.querySelector<HTMLButtonElement>('[data-play]'),
  )
}
