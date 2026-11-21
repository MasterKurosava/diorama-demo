import { app } from '../../../docs/diorama.ts'

interface Instance {
  readonly params: Record<string, unknown>
  readonly status: { readonly value: string }
}

/** Presence that the effect's smoothstep turns into `y`. */
const unsmooth = (y: number) => 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3)

// The image never leaves the screen here, so the example plays the reveal again after a change:
// the copy's presence rises the way the reveal runs, so the blocks halve at an even pace.
export default function mount(example: HTMLElement): () => void {
  const image = example.querySelector('.astrolabe')
  const button =
    example.querySelector<HTMLButtonElement>('[data-replay]')
  if (!image) return () => {}
  let stop: AbortController | undefined
  let timer = 0
  const again = (wait = 0) => {
    const instance = app.effects.get(
      image,
      'pixelate' as never,
    ) as unknown as Instance | undefined
    if (
      instance?.status.value !== 'running' ||
      instance.params.trigger !== 'view'
    )
      return
    stop?.abort()
    const current = new AbortController()
    stop = current
    const copy = app.effects.take(image, {
      leave: 'release',
      signal: current.signal,
    })
    copy.presence = 0
    const start = performance.now() + wait
    const step = (now: number) => {
      if (current.signal.aborted) return
      const duration = Number(instance.params.duration ?? 1.2) * 1000
      const p = Math.min(
        1,
        Math.max(0, (now - start) / Math.max(duration, 1)),
      )
      copy.presence = p <= 0 ? 0 : p >= 1 ? 1 : unsmooth(p)
      if (p < 1) requestAnimationFrame(step)
      else current.abort()
    }
    requestAnimationFrame(step)
  }
  const onChange = (e: Event) => {
    const { rebuild } = (
      e as CustomEvent<{ name: string; rebuild: boolean }>
    ).detail
    clearTimeout(timer)
    // A switch rebuilds the effect first; a slider plays once it rests.
    timer = window.setTimeout(() => again(), rebuild ? 400 : 300)
  }
  const onClick = () => again()
  example.addEventListener('doc-example:change', onChange)
  button?.addEventListener('click', onClick)
  return () => {
    clearTimeout(timer)
    stop?.abort()
    example.removeEventListener('doc-example:change', onChange)
    button?.removeEventListener('click', onClick)
  }
}
