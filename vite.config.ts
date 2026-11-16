import { fileURLToPath } from 'node:url'
import { glsl } from '@diorama/glsl/vite'
import { diorama } from 'diorama/vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default {
  // .frag files in src/effects become effects too.
  plugins: [glsl(), diorama()],
  // A linked library would otherwise pull its own copy of three.
  resolve: { dedupe: ['three'] },
  // Every page needs an entry even though navigation between them is client-side.
  build: {
    rollupOptions: {
      input: {
        index: here('index.html'),
        ridges: here('work/ridges/index.html'),
        lantern: here('work/lantern/index.html'),
      },
    },
  },
}
