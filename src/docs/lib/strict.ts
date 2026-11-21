// Content problems found by remark plugins. `astro build` fails on them; in dev a thrown error can
// take the whole server down, so the problem is logged and shown at the top of the page instead.
import type { Root } from 'mdast'

// On globalThis: the integration sets the flag in the config module graph, while pages read it
// from Vite's SSR graph, which loads its own copy of this file and reloads it on edits.
const key = Symbol.for('diorama.docs.strict')
const flags = globalThis as { [key]?: boolean }

/** Set by the docs integration from the Astro command. */
export function setStrict(value: boolean): void {
  flags[key] = value
}

export const isStrict = (): boolean => flags[key] ?? true

export function reportProblems(
  tree: Root,
  path: string | undefined,
  title: string,
  problems: readonly string[],
): void {
  if (!problems.length) return
  const text = `${path ?? 'page'}:\n  ${problems.join('\n  ')}`
  if (isStrict()) throw new Error(text)
  console.error(`[docs] ${title} in ${text}`)
  tree.children.unshift({
    type: 'paragraph',
    data: { hName: 'div', hProperties: { className: ['dev-problem'], role: 'alert' } },
    children: [{ type: 'text', value: `${title}, the build will fail:\n${problems.join('\n')}` }],
  })
}
