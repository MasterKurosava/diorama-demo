// Remark plugin: the Markdown twin of a page. Components become plain Markdown
// through their converters; the result goes to `remarkPluginFrontmatter.markdown`.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Code,
  Heading,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
} from 'mdast'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { findSymbol, membersMarkdown, signatureText, tokensText } from './api.ts'
import { installCommand, keyLabel, MANAGERS, runCommand } from './commands.ts'
import { type EffectMeta, paramsMarkdown } from './effects.ts'
import { reportProblems } from './strict.ts'
import { load } from './tables.ts'

interface JsxAttribute {
  readonly type: 'mdxJsxAttribute'
  readonly name: string
  readonly value?: string | { readonly value: string } | null
}
export interface JsxNode {
  readonly type: 'mdxJsxFlowElement' | 'mdxJsxTextElement'
  readonly name: string | null
  readonly attributes: readonly JsxAttribute[]
  readonly children: RootContent[]
}

export function attr(node: JsxNode, name: string): string | undefined {
  const a = node.attributes.find((x) => x.type === 'mdxJsxAttribute' && x.name === name)
  if (!a) return undefined
  if (a.value === null || a.value === undefined) return 'true'
  return typeof a.value === 'string' ? a.value : a.value.value
}

const text = (value: string): PhrasingContent => ({ type: 'text', value })
const para = (...children: PhrasingContent[]): Paragraph => ({ type: 'paragraph', children })
const heading = (depth: number, value: string): Heading => ({
  type: 'heading',
  depth: Math.min(6, Math.max(2, depth)) as Heading['depth'],
  children: [text(value)],
})
const code = (lang: string, value: string, meta?: string): Code => ({
  type: 'code',
  lang,
  meta: meta ?? null,
  value,
})
const raw = (value: string): RootContent => ({ type: 'html', value })

/** Twoslash markup stays out of the twin: hidden setup above `---cut---`, queries, directives. */
export function cleanCode(value: string): string {
  const cut = value.split(/^\/\/ ---cut---\n/m)
  const body = cut.length > 1 ? (cut[cut.length - 1] ?? '') : value
  return body
    .split('\n')
    .filter((line) => !/^\s*\/\/\s*(\^\?|\^\||@errors|@noErrors|@filename|@ts-)/.test(line))
    .join('\n')
}

const KEEP_META = /\btitle="[^"]*"/

function fileTree(list: List, depth = 0): string[] {
  const lines: string[] = []
  for (const item of list.children as ListItem[]) {
    const [first, ...rest] = item.children
    const label = first ? toMarkdown(first).trim().replaceAll('**', '') : ''
    lines.push(`${'  '.repeat(depth)}${label}`)
    for (const child of rest) if (child.type === 'list') lines.push(...fileTree(child, depth + 1))
  }
  return lines
}

type Converter = (node: JsxNode, depth: number) => RootContent[]

/** Files of a live example, index.html first: src/examples/<id>/. */
export function exampleFiles(id: string): { name: string; text: string }[] {
  const dir = join(process.cwd(), 'src/examples', id)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.(html|ts)$/.test(f))
    .sort((a, b) => Number(b === 'index.html') - Number(a === 'index.html') || a.localeCompare(b))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8').trim() }))
}

/** Files a live example shows: card files belong to the gallery. */
const shownFiles = (id: string) => exampleFiles(id).filter((f) => !f.name.startsWith('card.'))

/** Markdown of a live example: its description, then its files (or the ones `keep` takes). */
export function exampleMarkdown(
  id: string,
  description: string,
  keep: (name: string) => boolean = () => true,
): string {
  const fence = '```'
  const files = shownFiles(id)
    .filter((f) => keep(f.name))
    .map(
      (f) =>
        `${fence}${f.name.endsWith('.html') ? 'html' : 'ts'} title="${f.name}"\n${f.text}\n${fence}`,
    )
  return [description, ...files].join('\n\n')
}

const CONVERTERS: Record<string, Converter> = {
  Params: (node) => {
    const name = attr(node, 'effect') ?? ''
    const meta = (load().effects.effects as unknown as EffectMeta[]).find((e) => e.name === name)
    if (!meta) throw new Error(`Params: no effect "${name}" in the metadata`)
    const only = attr(node, 'only')
    const params = only ? meta.params.filter((p) => only.includes(`'${p.name}'`)) : meta.params
    return [raw(paramsMarkdown({ params }))]
  },
  Example: (node) => [
    para(text(attr(node, 'description') ?? '')),
    ...shownFiles(attr(node, 'id') ?? '').map((f) =>
      code(f.name.endsWith('.html') ? 'html' : 'ts', f.text, `title="${f.name}"`),
    ),
  ],
  Tabs: (node, depth) =>
    node.children.flatMap((tab) => {
      const t = tab as unknown as JsxNode
      if (t.type !== 'mdxJsxFlowElement' || t.name !== 'Tab') return []
      return [heading(depth + 1, attr(t, 'label') ?? ''), ...convertChildren(t.children, depth + 1)]
    }),
  Install: (node, depth) =>
    MANAGERS.flatMap((pm) => [
      heading(depth + 1, pm.label),
      code(
        'sh',
        installCommand(pm.value, attr(node, 'packages') ?? '', attr(node, 'dev') === 'true'),
      ),
    ]),
  Run: (node, depth) =>
    MANAGERS.flatMap((pm) => [
      heading(depth + 1, pm.label),
      code('sh', runCommand(pm.value, attr(node, 'command') ?? '')),
    ]),
  Callout: (node, depth) => {
    const label =
      attr(node, 'title') ??
      { note: 'Note', warning: 'Warning', performance: 'Performance' }[
        attr(node, 'kind') ?? 'note'
      ] ??
      'Note'
    const children = convertChildren(node.children, depth)
    const [first, ...rest] = children
    if (first?.type === 'paragraph') return [para(text(`${label}: `), ...first.children), ...rest]
    return [para(text(`${label}:`)), ...children]
  },
  FileTree: (node) => {
    const list = node.children.find((c) => c.type === 'list') as List | undefined
    return list ? [code('text', fileTree(list).join('\n'))] : []
  },
  Steps: (node, depth) => convertChildren(node.children, depth),
  Api: (node) => {
    const ref = attr(node, 'symbol') ?? ''
    const part = attr(node, 'part') ?? 'signature'
    const { symbol, member } = findSymbol(ref)
    const out: RootContent[] = []
    if (member) {
      const type =
        member.kind === 'method'
          ? tokensText(member.signatures[0]?.tokens ?? [])
          : tokensText(member.type)
      if (part !== 'summary')
        out.push(code('ts', `${member.name}${member.optional ? '?' : ''}: ${type}`))
      if (part !== 'signature' && member.summary) out.push(raw(member.summary))
      return out
    }
    if (part === 'signature' || part === 'full') {
      const sigs = symbol.signatures.map((s) => signatureText(s))
      const decl = symbol.declaration ? [tokensText(symbol.declaration)] : []
      out.push(code('ts', (sigs.length ? sigs : decl).join('\n')))
    }
    if ((part === 'summary' || part === 'full') && symbol.summary) out.push(raw(symbol.summary))
    if (part === 'members' || part === 'full') out.push(raw(membersMarkdown(symbol.members)))
    return out
  },
}

const INLINE: Record<string, (node: JsxNode) => string> = {
  Kbd: (node) => (attr(node, 'keys') ?? '').split('+').filter(Boolean).map(keyLabel).join('+'),
  Badge: (node) => `(${attr(node, 'text') ?? ''})`,
}

function convertInline(children: PhrasingContent[]): PhrasingContent[] {
  return children.flatMap((child) => {
    const node = child as unknown as JsxNode
    if (node.type === 'mdxJsxTextElement') {
      const convert = node.name ? INLINE[node.name] : undefined
      if (!convert) throw new Error(`No Markdown form for <${node.name}>`)
      return [text(convert(node))]
    }
    if ((child as { type: string }).type === 'mdxTextExpression') return []
    if ('children' in child && Array.isArray(child.children)) {
      return [
        {
          ...child,
          children: convertInline(child.children as PhrasingContent[]),
        } as PhrasingContent,
      ]
    }
    return [child]
  })
}

export function convertChildren(children: readonly RootContent[], depth: number): RootContent[] {
  const out: RootContent[] = []
  let level = depth
  for (const child of children) {
    const type = (child as { type: string }).type
    if (type === 'mdxjsEsm' || type === 'mdxFlowExpression') continue
    if (type === 'mdxJsxFlowElement') {
      const node = child as unknown as JsxNode
      const convert = node.name ? CONVERTERS[node.name] : undefined
      if (!convert) throw new Error(`No Markdown form for <${node.name}>`)
      out.push(...convert(node, level))
      continue
    }
    if (child.type === 'heading') level = child.depth
    if (child.type === 'code') {
      const meta = child.meta?.match(KEEP_META)?.[0] ?? null
      out.push({ ...child, meta, value: cleanCode(child.value) })
      continue
    }
    if ('children' in child && Array.isArray(child.children)) {
      const kids = child.children as RootContent[]
      const inline =
        child.type === 'paragraph' || child.type === 'heading' || child.type === 'tableCell'
      out.push({
        ...child,
        children: inline ? convertInline(kids as PhrasingContent[]) : convertChildren(kids, level),
      } as RootContent)
      continue
    }
    out.push(child)
  }
  return out
}

export function treeToMarkdown(tree: Root): string {
  const root: Root = { type: 'root', children: convertChildren(tree.children, 1) }
  return toMarkdown(root as Nodes, { extensions: [gfmToMarkdown()], bullet: '-', rule: '-' }).trim()
}

export function remarkTwin() {
  return (
    tree: Root,
    file: { path?: string; data: { astro?: { frontmatter?: Record<string, unknown> } } },
  ) => {
    file.data.astro ??= {}
    const astro = file.data.astro
    astro.frontmatter ??= {}
    try {
      astro.frontmatter.markdown = treeToMarkdown(tree)
    } catch (error) {
      astro.frontmatter.markdown = ''
      reportProblems(tree, file.path, 'Markdown twin failed', [(error as Error).message])
    }
  }
}
