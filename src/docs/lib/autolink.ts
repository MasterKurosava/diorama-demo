// Rehype plugin: `inline code` that names an API symbol, attribute, input or error code becomes a
// link. Not inside headings, links or code blocks, not to the page itself and once
// per h2 section. Raw HTML `<code>` opts out because it never reaches this tree as mdast code.
import type { Element, ElementContent, Root, RootContent } from 'hast'
import type { Linker } from './links.ts'
import { load } from './tables.ts'

const HEADING = /^h[1-6]$/

/** URL of a content file: src/content/docs/start/vite.mdx is /docs/start/vite. */
export function urlOfFile(path: string | undefined): string | undefined {
  if (!path) return undefined
  const m = /src[\\/]content[\\/](docs|errors)[\\/](.+)\.mdx?$/.exec(path)
  if (!m?.[2]) return undefined
  const rest = m[2].replaceAll('\\', '/').replace(/(^|\/)index$/, '')
  if (m[1] === 'errors') return `/docs/errors/${rest}`
  return rest ? `/docs/${rest}` : '/docs'
}

const textOf = (node: ElementContent): string =>
  node.type === 'text'
    ? node.value
    : node.type === 'element'
      ? node.children.map(textOf).join('')
      : ''

export function autolinkTree(tree: Root, linker: Linker, self?: string): void {
  let seen = new Set<string>()
  const visit = (parent: Root | Element, skip: boolean): void => {
    parent.children.forEach((child: RootContent, index: number) => {
      if (child.type !== 'element') return
      if (child.tagName === 'h2') seen = new Set()
      const blocked =
        skip || HEADING.test(child.tagName) || child.tagName === 'a' || child.tagName === 'pre'
      if (child.tagName === 'code' && !blocked) {
        const href = linker.resolve(textOf(child))
        const page = href?.split('#')[0]
        if (!href || page === self || seen.has(href)) return
        seen.add(href)
        const link: Element = {
          type: 'element',
          tagName: 'a',
          properties: { href, className: ['code-link'] },
          children: [child],
        }
        parent.children[index] = link
        return
      }
      visit(child, blocked)
    })
  }
  visit(tree, false)
}

export function rehypeAutolink() {
  return (tree: Root, file: { path?: string; history?: string[] }) => {
    const { linker } = load()
    autolinkTree(tree, linker, urlOfFile(file.path ?? file.history?.[0]))
  }
}
