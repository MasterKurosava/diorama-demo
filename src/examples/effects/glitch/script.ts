import { app } from '../../../docs/diorama.ts'

// The controls write to the first cover; the others follow, so the row stays alike.
export default function mount(example: HTMLElement): () => void {
  const onChange = (e: Event) => {
    const { name, value } = (
      e as CustomEvent<{ name: string; value: unknown }>
    ).detail
    const [, ...rest] = example.querySelectorAll('.ex-root [data-dio]')
    for (const el of rest) {
      const instance = app.effects.get(el, 'glitch' as never) as
        | { params: Record<string, unknown> }
        | undefined
      if (instance) instance.params[name] = value
    }
  }
  example.addEventListener('doc-example:change', onChange)
  return () =>
    example.removeEventListener('doc-example:change', onChange)
}
