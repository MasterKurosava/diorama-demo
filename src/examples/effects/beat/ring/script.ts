import { player } from '../../visualizer/_player.ts'

// The round button is the player's only control, and the beat runs on it.
export default function mount(example: HTMLElement): () => void {
  return player(
    example,
    example.querySelector<HTMLButtonElement>('.bt-play'),
  )
}
