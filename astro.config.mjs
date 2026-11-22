import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unified } from '@astrojs/markdown-remark'
import mdx from '@astrojs/mdx'
import { diorama } from '@dioramajs/diorama/astro'
import { glsl } from '@dioramajs/glsl/vite'
import expressiveCode from 'astro-expressive-code'
import { docs } from './src/docs/integration.ts'
import { rehypeAutolink } from './src/docs/lib/autolink.ts'
import { remarkCheckMarkup } from './src/docs/lib/check-markup.ts'
import { remarkTwin } from './src/docs/lib/twin.ts'
import { SITE } from './src/docs/site.ts'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

export default {
  // The drive letter as the file system spells it. Vite ids use that spelling while a root taken
  // from the working directory may not (c: against C: on Windows), and then Astro finds no page
  // for any stylesheet and links none.
  root: realpathSync.native(here('.')),
  site: SITE,
  // Pages are written as docs/start/vite.html, served at /docs/start/vite next to vite.md.
  trailingSlash: 'never',
  build: { format: 'file' },
  prefetch: true,
  // Remark and rehype plugins need the unified processor; Expressive Code joins it on its own.
  markdown: {
    processor: unified({
      remarkPlugins: [remarkCheckMarkup, remarkTwin],
      rehypePlugins: [rehypeAutolink],
    }),
  },
  // Expressive Code reads its options from ec.config.mjs.
  integrations: [diorama(), expressiveCode(), mdx(), docs()],
  vite: {
    // .frag files in src/effects become effects too.
    plugins: [glsl()],
    resolve: {
      // The linked library would otherwise pull its own copy of three.
      dedupe: ['three'],
    },
  },
  server: { port: 4174 },
}
