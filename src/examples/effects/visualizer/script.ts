import { player } from './_player.ts'

// Play in the panel drives the <audio> above the bars.
export default function mount(example: HTMLElement): () => void {
  return player(
    example,
    example.querySelector<HTMLButtonElement>('[data-play]'),
  )
}
