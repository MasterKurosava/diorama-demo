// Baking on the main thread would drop frames.
import { bakeAll } from './_ice-bake'

addEventListener('message', async () => {
  const baked = await bakeAll()
  postMessage(baked, { transfer: [baked.relief.buffer, baked.detail.buffer, baked.frost.buffer] })
})
