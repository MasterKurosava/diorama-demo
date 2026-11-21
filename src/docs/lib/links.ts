// Resolves `inline code` text to a docs URL. Pure: the tables are passed in, so the
// rehype plugin, the API components and the tests share it.

export interface SymbolRow {
  readonly id: number | string
  readonly name: string
  readonly module: string
  readonly kind: string
  readonly url: string
  readonly signature?: string
  readonly summary?: string
  readonly member?: boolean
}

export interface Aliases {
  /** Ambiguous or shortened names resolved by hand: `effect` to the diorama one. */
  readonly names: Readonly<Record<string, string>>
  /** `app.<service>` to the interface that holds its members: `app.effects` to `EffectsApi`. */
  readonly services: Readonly<Record<string, string>>
}

export interface LinkTables {
  readonly symbols: readonly SymbolRow[]
  readonly aliases: Aliases
  /** Reserved `data-dio-*` names without the prefix: 'key', 'state'. */
  readonly reserved: readonly string[]
  /** Built-in inputs: 'pointer', 'hover'. */
  readonly inputs: readonly string[]
  /** Error codes that have a page. */
  readonly codes: ReadonlySet<string>
  /** Effects that have a page. */
  readonly effects: ReadonlySet<string>
}

export interface Linker {
  resolve(text: string): string | undefined
  /** Names that match more than one symbol and have no alias. */
  readonly ambiguous: readonly string[]
}

export const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/

export const codeSlug = (code: string): string => code.toLowerCase().replaceAll('_', '-')

export function createLinker(tables: LinkTables): Linker {
  const byName = new Map<string, Set<string>>()
  const members = new Map<string, string>()
  for (const row of tables.symbols) {
    if (row.member) {
      members.set(row.name, row.url)
      continue
    }
    const set = byName.get(row.name) ?? new Set<string>()
    set.add(row.url)
    byName.set(row.name, set)
  }
  const ambiguous = [...byName]
    .filter(([name, urls]) => urls.size > 1 && !tables.aliases.names[name])
    .map(([name]) => name)
  const reserved = new Set(tables.reserved)
  const inputs = new Set(tables.inputs)

  const symbol = (name: string): string | undefined => {
    const alias = tables.aliases.names[name]
    if (alias) return alias
    const urls = byName.get(name)
    return urls?.size === 1 ? [...urls][0] : undefined
  }

  function resolve(raw: string): string | undefined {
    const text = raw.trim()
    if (CODE.test(text))
      return tables.codes.has(text) ? `/docs/errors/${codeSlug(text)}` : undefined
    const effect = /^data-dio="([a-z][a-z0-9-]*)"$/.exec(text)
    if (effect?.[1]) return tables.effects.has(effect[1]) ? `/docs/effects/${effect[1]}` : undefined
    if (text === 'data-dio') return '/docs/api/markup#data-dio'
    const attr = /^data-dio-([a-z-]+)$/.exec(text)
    if (attr?.[1]) return reserved.has(attr[1]) ? `/docs/api/markup#data-dio-${attr[1]}` : undefined
    const input = /^(?:u|input)\.([A-Za-z]+)$/.exec(text)
    if (input?.[1]) return inputs.has(input[1]) ? `/docs/api/inputs#${input[1]}` : undefined
    const service = /^app\.([a-z]+)(?:\.([A-Za-z]+))?(?:\(\))?$/.exec(text)
    if (service?.[1]) {
      const owner = tables.aliases.services[service[1]]
      if (!owner) return undefined
      if (!service[2]) return symbol(owner)
      return members.get(`${owner}.${service[2]}`)
    }
    const name = text.replace(/\(\)$/, '')
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(name)) return undefined
    if (name.includes('.')) return members.get(name)
    return symbol(name)
  }

  return { resolve, ambiguous }
}
