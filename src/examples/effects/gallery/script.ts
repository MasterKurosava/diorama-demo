import { pager } from './_pager.ts'

// Previous and Next, the counter and the room name under the preview.
export default function mount(example: HTMLElement): () => void {
  const rooms = example.querySelector<HTMLElement>('.rooms')
  return rooms ? pager(example, rooms) : () => {}
}
