import { pager } from '../_pager.ts'

// The thumbnails choose a view and show which one is on.
export default function mount(example: HTMLElement): () => void {
  const shots = example.querySelector<HTMLElement>('.product .shots')
  return shots ? pager(example, shots) : () => {}
}
