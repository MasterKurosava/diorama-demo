// Reads the generated library data from disk for build-time plugins and checks.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import aliases from './aliases.json' with { type: 'json' }
import {
  type Aliases,
  createLinker,
  type Linker,
  type LinkTables,
  type SymbolRow,
} from './links.ts'

const root = process.cwd()
const generated = (name: string) => join(root, 'src/generated', name)

function read<T>(name: string, fallback: T): T {
  const file = generated(name)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
}

interface ApiLite {
  readonly symbols: readonly {
    readonly name: string
    readonly module: string
    readonly declaration?: readonly (readonly string[] | { more: number; tokens: string[][] })[]
    readonly members: readonly { readonly name: string; readonly type: readonly unknown[] }[]
  }[]
}

export interface EffectsData {
  readonly pending: boolean
  readonly effects: readonly {
    readonly name: string
    readonly package?: string
    readonly params: readonly {
      readonly name: string
      readonly attribute?: string
      readonly type: string
    }[]
  }[]
}

/** Members of a string-literal union from its declaration tokens. */
export function unionMembers(api: ApiLite, name: string): string[] {
  const sym = api.symbols.find((s) => s.name === name)
  const out: string[] = []
  for (const t of sym?.declaration ?? []) {
    const parts = 'more' in t ? t.tokens : [t]
    for (const p of parts) if (p[1] === 's' && p[0]) out.push(p[0].replace(/^'|'$/g, ''))
  }
  return out
}

/** Effects that have a page. */
export function effectPages(data: EffectsData): Set<string> {
  const dir = join(root, 'src/content/effects')
  return new Set(
    data.effects.map((e) => e.name).filter((name) => existsSync(join(dir, `${name}.mdx`))),
  )
}

let packages: Set<string> | undefined

/** Names an Install block may use: the library's packages and their peer dependencies. */
export function libraryPackages(): ReadonlySet<string> {
  if (packages) return packages
  packages = new Set()
  const dir = join(realpathSync(join(root, 'node_modules/dioramajs')), '..')
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
      name: string
      private?: boolean
      peerDependencies?: Record<string, string>
    }
    if (pkg.private) continue
    packages.add(pkg.name)
    for (const peer of Object.keys(pkg.peerDependencies ?? {})) packages.add(peer)
  }
  return packages
}

let cached: { tables: LinkTables; linker: Linker; effects: EffectsData } | undefined
let stamp = ''

/** Modification times of the generated files, so a running dev server sees regenerated data. */
const stampOf = (): string =>
  ['api.json', 'effects.json', 'errors.json', 'symbols.json']
    .map((name) => (existsSync(generated(name)) ? statSync(generated(name)).mtimeMs : 0))
    .join(',')

export function load(): { tables: LinkTables; linker: Linker; effects: EffectsData } {
  const now = stampOf()
  if (cached && now === stamp) return cached
  stamp = now
  const api = read<ApiLite>('api.json', { symbols: [] })
  const effects = read<EffectsData>('effects.json', { pending: true, effects: [] })
  const errorsDir = join(root, 'src/content/errors')
  const pages = existsSync(errorsDir) ? readdirSync(errorsDir) : []
  const codes = new Set(
    read<{ code: string }[]>('errors.json', [])
      .map((e) => e.code)
      .filter((code) => pages.includes(`${code.toLowerCase().replaceAll('_', '-')}.mdx`)),
  )
  const inputs =
    api.symbols.find((s) => s.name === 'InputUniforms')?.members.map((m) => m.name) ?? []
  const tables: LinkTables = {
    symbols: read<SymbolRow[]>('symbols.json', []),
    aliases: aliases as Aliases,
    reserved: unionMembers(api, 'ReservedAttr'),
    inputs,
    codes,
    effects: effectPages(effects),
  }
  cached = { tables, linker: createLinker(tables), effects }
  return cached
}
