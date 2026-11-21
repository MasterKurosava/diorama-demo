// The one module that starts Diorama for the docs. At the merge the landing's src/diorama.ts
// replaces it: one start() per session, with Lenis on the landing only.
import { start } from 'dioramajs'

// Text pages never ask for the engine: it loads when an example nears the viewport.
// Its transitions plugin also lets clicks through while a page change animates.
export const app = start({ prefetch: false })

type Unmount = () => void

/** Mounts on every page that has `selector`, unmounts before the next page replaces it. */
export function onPage(selector: string, mount: (element: Element) => Unmount | undefined): void {
  let mounted: Unmount[] = []
  document.addEventListener('astro:page-load', () => {
    for (const element of document.querySelectorAll(selector)) {
      const off = mount(element)
      if (off) mounted.push(off)
    }
  })
  document.addEventListener('astro:before-swap', () => {
    for (const off of mounted) off()
    mounted = []
  })
}
