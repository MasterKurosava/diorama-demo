import { player } from '../_player.ts'

// The round button in the middle of the ring is the player's only control.
export default function mount(example: HTMLElement): () => void {
  return player(
    example,
    example.querySelector<HTMLButtonElement>('.vz-play'),
  )
}
