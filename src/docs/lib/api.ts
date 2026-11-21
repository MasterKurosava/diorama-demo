// The API reference model written by scripts/api.mjs, plus its Markdown form.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** [text, kind?, href?]; kinds: k keyword, s string, n number, t type, f function name. */
export type Token =
  | readonly [string, string?, string?]
  | { readonly more: number; readonly tokens: readonly Token[] }

export interface ApiParam {
  readonly name: string
  readonly optional: boolean
  readonly default?: string
  readonly type: readonly Token[]
  readonly summary: string
}

export interface ApiSignature {
  readonly tokens: readonly Token[]
  readonly summary: string
  readonly params: readonly ApiParam[]
  readonly returns: { readonly type: readonly Token[]; readonly summary: string }
}

export interface ApiMember {
  readonly name: string
  readonly kind: 'property' | 'method'
  readonly optional: boolean
  readonly readonly: boolean
  readonly type: readonly Token[]
  readonly signatures: readonly ApiSignature[]
  readonly summary: string
  readonly default?: string
}

export interface ApiSymbol {
  readonly id: number
  readonly name: string
  readonly kind: string
  readonly module: string
  readonly specifier: string
  readonly url: string
  readonly summary: string
  readonly examples: readonly string[]
  readonly throws: readonly string[]
  readonly deprecated: boolean
  readonly also: readonly string[]
  readonly source?: { readonly file: string; readonly line: number; readonly url: string }
  readonly signatures: readonly ApiSignature[]
  readonly declaration?: readonly Token[]
  readonly members: readonly ApiMember[]
  readonly signature: string
}

export interface ApiModule {
  readonly slug: string
  readonly specifier: string
  readonly package: string
  readonly lowLevel: boolean
  readonly summary: string
  readonly symbols: readonly number[]
}

export interface ApiData {
  readonly modules: readonly ApiModule[]
  readonly symbols: readonly ApiSymbol[]
}

let cached: ApiData | undefined

export function api(): ApiData {
  if (cached) return cached
  const file = join(process.cwd(), 'src/generated/api.json')
  if (!existsSync(file))
    throw new Error('src/generated/api.json is missing: run node scripts/api.mjs')
  cached = JSON.parse(readFileSync(file, 'utf8')) as ApiData
  return cached
}

export const isType = (s: ApiSymbol): boolean => ['interface', 'type', 'enum'].includes(s.kind)

export function moduleSymbols(mod: ApiModule): ApiSymbol[] {
  const byId = new Map(api().symbols.map((s) => [s.id, s]))
  return mod.symbols.flatMap((id) => byId.get(id) ?? [])
}

/** '<module>:<name>[.<member>]' as in the Api component. */
export function findSymbol(ref: string): { symbol: ApiSymbol; member?: ApiMember } {
  const [module, path = ''] = ref.split(':')
  const [name, member] = path.split('.')
  const mod = api().modules.find((m) => m.slug === module)
  const symbol = mod && moduleSymbols(mod).find((s) => s.name === name)
  if (!symbol) throw new Error(`Api: no symbol "${ref}"`)
  if (!member) return { symbol }
  const found = symbol.members.find((m) => m.name === member)
  if (!found) throw new Error(`Api: no member "${ref}"`)
  return { symbol, member: found }
}

export const tokensText = (tokens: readonly Token[]): string =>
  tokens.map((t) => ('more' in t ? tokensText(t.tokens) : t[0])).join('')

/** Signature text with parameters on their own lines when the line is long. */
export function signatureText(sig: ApiSignature, width = 80): string {
  const text = tokensText(sig.tokens)
  if (text.length <= width || sig.params.length === 0) return text
  const open = text.indexOf('(')
  const head = text.slice(0, open)
  const params = sig.params.map(
    (p) => `  ${p.name}${p.optional ? '?' : ''}: ${tokensText(p.type)},`,
  )
  return `${head}(\n${params.join('\n')}\n): ${tokensText(sig.returns.type)}`
}

export const importLine = (s: ApiSymbol): string =>
  `import ${isType(s) ? 'type ' : ''}{ ${s.name} } from '${s.specifier}'`

const cell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

export function membersMarkdown(members: readonly ApiMember[]): string {
  if (!members.length) return ''
  const rows = members.map((m) => {
    const type =
      m.kind === 'method' ? tokensText(m.signatures[0]?.tokens ?? []) : tokensText(m.type)
    return `| \`${m.name}${m.optional ? '?' : ''}\` | \`${cell(type)}\` | ${cell(m.summary)} |`
  })
  return ['| Name | Type | Description |', '| --- | --- | --- |', ...rows].join('\n')
}

export function symbolMarkdown(s: ApiSymbol): string {
  const out = [
    `# ${s.name}`,
    '',
    `${s.kind} in \`${s.specifier}\``,
    '',
    '```ts',
    importLine(s),
    '```',
  ]
  if (s.summary) out.push('', s.summary)
  for (const sig of s.signatures) {
    out.push('', '```ts', signatureText(sig), '```')
    if (sig.params.length) {
      out.push('', '| Parameter | Type | Description |', '| --- | --- | --- |')
      for (const p of sig.params) {
        out.push(
          `| \`${p.name}${p.optional ? '?' : ''}\` | \`${cell(tokensText(p.type))}\` | ${cell(p.summary)} |`,
        )
      }
    }
    if (sig.returns.summary) out.push('', `Returns ${sig.returns.summary}`)
  }
  if (!s.signatures.length && s.declaration) out.push('', '```ts', tokensText(s.declaration), '```')
  for (const t of s.throws) out.push('', `Throws ${t}`)
  for (const e of s.examples) out.push('', e)
  if (s.members.length) out.push('', '## Members', '', membersMarkdown(s.members))
  if (s.also.length) out.push('', `Also exported from ${s.also.map((a) => `\`${a}\``).join(', ')}.`)
  if (s.source) out.push('', `Defined in [${s.source.file}](${s.source.url}).`)
  return `${out.join('\n')}\n`
}
