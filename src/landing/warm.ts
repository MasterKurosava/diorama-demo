// Loads and compiles the chapters below while the reader is idle. Effects normally load as they
// near the screen and compile on first draw, which on some machines stalls for about 100 ms in
// the middle of a scroll.
import type { App } from 'dioramajs'
import type { Object3D } from 'three/webgpu'

const SETTLED = new Set(['drawn', 'live', 'failed', 'off'])

export function warmAhead(app: App, elements: Element[], after: Promise<unknown>): () => void {
  const done = new AbortController()
  const compiled = new WeakSet<Object3D>()
  let lastScroll = performance.now()
  const scrolled = (): void => {
    lastScroll = performance.now()
  }
  addEventListener('scroll', scrolled, { passive: true, signal: done.signal })
  addEventListener('pointerdown', scrolled, { passive: true, signal: done.signal })

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // Resolves after 700 ms without scroll or taps, once the browser is idle.
  const still = async (): Promise<void> => {
    for (;;) {
      if (done.signal.aborted) throw new Error('stopped')
      const quiet = performance.now() - lastScroll
      if (quiet > 700) {
        await new Promise<void>((r) =>
          'requestIdleCallback' in window
            ? requestIdleCallback(() => r(), { timeout: 500 })
            : setTimeout(r, 50),
        )
        if (performance.now() - lastScroll > 700) return
      }
      await sleep(Math.max(120, 700 - quiet))
    }
  }
  const settled = async (el: Element): Promise<void> => {
    const since = performance.now()
    while (
      !SETTLED.has(el.getAttribute('data-dio-state') ?? '') &&
      performance.now() - since < 8000
    ) {
      if (done.signal.aborted) throw new Error('stopped')
      await sleep(100)
    }
  }

  void (async () => {
    await after
    for (const el of elements) {
      await still()
      if (!el.isConnected) continue
      el.setAttribute('data-dio-load', 'eager')
      // Children an effect attaches to (deck cards) have no state of their own to wait on.
      if (el.hasAttribute('data-dio')) await settled(el)
      else continue
      const render = app.effects?.render
      if (!render) continue
      const objects: Object3D[] = []
      render.scene.traverse((o) => {
        const drawable = o as Object3D & {
          isMesh?: boolean
          isSprite?: boolean
          isPoints?: boolean
        }
        if ((drawable.isMesh || drawable.isSprite || drawable.isPoints) && !compiled.has(o))
          objects.push(o)
      })
      for (const object of objects) {
        await still()
        compiled.add(object)
        // Compile the object directly, compiling the scene skips it while its layer is hidden.
        await render.renderer.compileAsync(object, render.camera, render.scene).catch(() => {})
      }
    }
  })().catch(() => {})

  return () => done.abort()
}
