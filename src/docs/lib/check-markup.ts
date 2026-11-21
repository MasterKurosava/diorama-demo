// Remark plugin, checks that run on every build: `html` blocks with data-dio use
// known effects, reserved attributes or params of those effects, with values of the right type;
// Install blocks name real packages. Effects defined in the page's own code blocks count.
import type { Code, Root, RootContent } from 'mdast'
import { reportProblems } from './strict.ts'
import { libraryPackages, load } from './tables.ts'
import { attr, exampleFiles, type JsxNode } from './twin.ts'

export interface EffectShape {
  readonly name: string
  readonly params: readonly {
    readonly name: string
    readonly type: string
    readonly values?: readonly string[]
    readonly default?: unknown
  }[]
  /** Attributes the effect reads from its children (metadata `children`): `data-dio-src`. */
  readonly children?: readonly string[]
}

export const kebab = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** Own effects of a page: `src/effects/brighten.ts` with `effect({ amount: 1 }, …)`. */
export function ownEffects(blocks: readonly Code[]): EffectShape[] {
  const out: EffectShape[] = []
  for (const block of blocks) {
    const title = /title="([^"]+)"/.exec(block.meta ?? '')?.[1] ?? ''
    const file =
      /(?:^|\/)effects\/([A-Za-z0-9_-]+)\.(?:ts|js|frag)$/.exec(title) ??
      /(?:^|\/)fx\/([a-z0-9-]+)\.js$/.exec(title)
    if (!file?.[1]) continue
    const name = kebab(file[1]).replaceAll('_', '-')
    const defaults = /effect\(\s*\{([^}]*)\}/.exec(block.value)?.[1] ?? ''
    const params = [...defaults.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*([^,]+)/g)].map((m) => ({
      name: m[1] ?? '',
      type: /^\s*(true|false)\s*$/.test(m[2] ?? '')
        ? 'boolean'
        : /^\s*-?[\d.]+\s*$/.test(m[2] ?? '')
          ? 'number'
          : 'string',
    }))
    out.push({ name, params })
  }
  return out
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/i

export function checkValue(type: string, value: string, values?: readonly string[]): boolean {
  switch (type) {
    case 'number':
      return NUMBER.test(value.trim())
    case 'boolean':
      return ['', 'true', 'false'].includes(value)
    case 'choice':
      return !values || values.includes(value)
    case 'vec2':
    case 'vec3':
    case 'vec4':
    case 'vector':
      return value.split(/[\s,]+/).every((v) => NUMBER.test(v))
    default:
      return true
  }
}

/** Attributes read by page-level plugins on any element, such as a link opting out of a cover. */
const PAGE_ATTRS = new Set(['data-dio-cover'])

/** Problems in one HTML snippet. `pending` skips name and param checks when metadata is missing. */
export function checkHtml(
  html: string,
  effects: readonly EffectShape[],
  reserved: readonly string[],
  pending: boolean,
): string[] {
  const problems: string[] = []
  const known = new Map(effects.map((e) => [e.name, e]))
  // Child data is read by an effect on an ancestor; the regex pass has no tree, so any effect counts.
  const childData = new Set(effects.flatMap((e) => e.children ?? []))
  for (const tag of html.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)) {
    const attrs = new Map<string, string>()
    for (const a of (tag[1] ?? '').matchAll(
      /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
    )) {
      attrs.set((a[1] ?? '').toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '')
    }
    const dio = attrs.get('data-dio')
    const names = dio === undefined ? [] : dio.split(/\s+/).filter(Boolean)
    for (const name of names) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`"${name}" is not an effect name`)
      else if (!known.has(name) && !pending) problems.push(`unknown effect "${name}"`)
    }
    for (const [key, value] of attrs) {
      if (!key.startsWith('data-dio-')) continue
      const rest = key.slice('data-dio-'.length)
      if (reserved.includes(rest)) continue
      if (!names.length) {
        if (childData.has(key) || PAGE_ATTRS.has(key)) continue
        problems.push(`${key} on an element without data-dio`)
        continue
      }
      const shapes = names.flatMap((n) => known.get(n) ?? [])
      if (shapes.length < names.length && pending) continue
      // Library rule: data-dio-<effect>-<param> addresses one effect and wins;
      // the short data-dio-<param> applies only when exactly one effect of the element has it.
      const addressed = shapes.flatMap((s) =>
        rest.startsWith(`${s.name}-`)
          ? s.params.filter((p) => kebab(p.name) === rest.slice(s.name.length + 1))
          : [],
      )
      const short = shapes.filter((s) => s.params.some((p) => kebab(p.name) === rest))
      const param =
        addressed[0] ??
        (short.length === 1 ? short[0]?.params.find((p) => kebab(p.name) === rest) : undefined)
      if (!addressed.length && short.length > 1) {
        const list = short.map((s) => s.name)
        problems.push(
          `${key} matches ${list.join(' and ')} and applies to neither; use data-dio-${list[0]}-${rest}`,
        )
      } else if (!param)
        problems.push(`${key} is neither reserved nor a param of ${names.join(', ')}`)
      else if (
        !(value.trim() === 'auto' && param.default === 'auto') &&
        !checkValue(param.type, value, param.values)
      )
        problems.push(`${key}="${value}" is not a ${param.type}`)
    }
  }
  return problems
}

function walk(node: Root | RootContent, visit: (node: RootContent) => void): void {
  if (node.type !== 'root') visit(node)
  if ('children' in node) for (const child of node.children as RootContent[]) walk(child, visit)
}

export function remarkCheckMarkup() {
  return (tree: Root, file: { path?: string }) => {
    const { tables, effects } = load()
    const blocks: Code[] = []
    const installs: JsxNode[] = []
    const examples: string[] = []
    walk(tree, (node) => {
      if (node.type === 'code') blocks.push(node)
      const jsx = node as unknown as JsxNode
      if (jsx.type === 'mdxJsxFlowElement' && jsx.name === 'Install') installs.push(jsx)
      if (jsx.type === 'mdxJsxFlowElement' && jsx.name === 'Example')
        examples.push(attr(jsx, 'id') ?? '')
    })
    const problems: string[] = []
    // An example's files are checked like the page's own blocks, its effect files define effects.
    for (const id of examples) {
      const files = exampleFiles(id)
      if (!files.some((f) => f.name === 'index.html'))
        problems.push(`Example "${id}": src/examples/${id}/index.html is missing`)
      for (const f of files) {
        blocks.push({
          type: 'code',
          lang: f.name.endsWith('.html') ? 'html' : 'ts',
          meta: `title="effects/${f.name}"`,
          value: f.text,
        })
      }
    }
    const shapes: EffectShape[] = [
      ...effects.effects.map((e) => ({
        name: e.name,
        params: e.params.map((p) => ({
          name: p.name,
          type: p.type,
          values: (p as { values?: string[] }).values,
        })),
        children: ((e as { children?: { attribute?: string }[] }).children ?? []).flatMap((c) =>
          c.attribute ? [c.attribute] : [],
        ),
      })),
      ...ownEffects(blocks),
    ]
    for (const block of blocks) {
      if (block.lang !== 'html' || !block.value.includes('data-dio')) continue
      if (/\bnocheck\b/.test(block.meta ?? '')) continue
      problems.push(...checkHtml(block.value, shapes, tables.reserved, effects.pending))
    }
    const allowed = libraryPackages()
    for (const node of installs) {
      for (const name of (attr(node, 'packages') ?? '').split(/\s+/).filter(Boolean)) {
        if (!allowed.has(name))
          problems.push(`Install names "${name}", which is not a library package`)
      }
    }
    reportProblems(tree, file.path, 'Markup check failed', problems)
  }
}
