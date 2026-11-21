// Search without the DOM: rewriters, engine, typo fallback, grouping and recent queries. The
// dialog renders what this returns, so it runs the same with a fake engine.
import { rewrite } from './rewriters.ts'
import type {
  PinnedHit,
  SearchData,
  SearchEngine,
  SearchFilters,
  SearchHit,
  SearchKind,
  SearchResult,
} from './types.ts'
import { correctQuery } from './typo.ts'

export const GROUPS: readonly { readonly kind: SearchKind; readonly label: string }[] = [
  { kind: 'effect', label: 'Effects' },
  { kind: 'guide', label: 'Guides' },
  { kind: 'api', label: 'API' },
  { kind: 'error', label: 'Errors' },
]
const PER_GROUP = 5
const RECENT_KEY = 'dio.search.recent'
const RECENT_MAX = 5

export interface Group {
  readonly kind: SearchKind
  readonly label: string
  readonly hits: readonly SearchHit[]
  readonly total: number
}

export interface PageLink {
  readonly url: string
  readonly title: string
  readonly kind: SearchKind
}

export interface View {
  readonly status: 'empty' | 'results' | 'none'
  readonly query: string
  readonly pinned: readonly PinnedHit[]
  readonly groups: readonly Group[]
  readonly count: number
  /** The corrected query when the typo fallback found one. */
  readonly typo?: string
  readonly recent: readonly string[]
  readonly popular: readonly PageLink[]
}

/** `b`'s hits after `a`'s, without repeats; counts grow by the hits added. */
function merge(a: SearchResult, b: SearchResult): SearchResult {
  const seen = new Set(a.hits.map((h) => h.url))
  const added = b.hits.filter((h) => !seen.has(h.url))
  const counts = { ...a.counts }
  for (const h of added) counts[h.kind] = (counts[h.kind] ?? 0) + 1
  return { hits: [...a.hits, ...added], counts, total: a.total + added.length }
}

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class SearchSession {
  readonly #engine: SearchEngine
  readonly #data: () => Promise<SearchData>
  readonly #store: KeyValueStore | undefined
  #last = 0

  constructor(engine: SearchEngine, data: () => Promise<SearchData>, store?: KeyValueStore) {
    this.#engine = engine
    this.#data = data
    this.#store = store
  }

  async init(): Promise<void> {
    await Promise.all([this.#engine.init(), this.#data()])
  }

  recent(): string[] {
    try {
      const list = JSON.parse(this.#store?.getItem(RECENT_KEY) ?? '[]') as unknown
      return Array.isArray(list)
        ? list.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
        : []
    } catch {
      return []
    }
  }

  remember(query: string): void {
    const q = query.trim()
    if (!q) return
    this.#write([q, ...this.recent().filter((x) => x !== q)].slice(0, RECENT_MAX))
  }

  forget(query: string): void {
    this.#write(this.recent().filter((x) => x !== query))
  }

  clear(): void {
    this.#write([])
  }

  #write(list: string[]): void {
    try {
      this.#store?.setItem(RECENT_KEY, JSON.stringify(list))
    } catch {
      // Storage can be full or blocked; recent queries are a convenience.
    }
  }

  async popular(): Promise<PageLink[]> {
    const data = await this.#data()
    return data.popular.flatMap((url) => {
      const page = data.pages.find((p) => p.url === url) ?? data.symbols.find((s) => s.url === url)
      if (!page) return []
      return [
        {
          url,
          title: 'title' in page ? page.title : page.name,
          kind: 'kind' in page && page.kind !== undefined ? (page.kind as SearchKind) : 'api',
        },
      ]
    })
  }

  /**
   * Runs a query. `expanded` shows every result of one group. Returns undefined when a newer
   * call started meanwhile, so a slow answer never replaces a fresh one.
   */
  async run(
    query: string,
    filters: SearchFilters = {},
    expanded?: SearchKind,
  ): Promise<View | undefined> {
    const ticket = ++this.#last
    const q = query.trim()
    if (!q) {
      const popular = await this.popular()
      return ticket === this.#last
        ? {
            status: 'empty',
            query: q,
            pinned: [],
            groups: [],
            count: 0,
            recent: this.recent(),
            popular,
          }
        : undefined
    }
    const data = await this.#data()
    const { pinned, query: rewritten, also = [] } = rewrite(q, data)
    let result = await this.#engine.search(rewritten, filters)
    if (result.total + pinned.length < 3) {
      for (const word of also) result = merge(result, await this.#engine.search(word, filters))
    }
    let typo: string | undefined
    if (result.total + pinned.length < 3) {
      const fixed = correctQuery(rewritten, data.words)
      if (fixed) {
        const again = await this.#engine.search(fixed, filters)
        if (again.total > result.total) {
          result = again
          typo = fixed
        }
      }
    }
    let byKind = new Map<SearchKind, SearchHit[]>()
    const pinnedUrls = new Set(pinned.map((p) => p.url))
    for (const hit of result.hits) {
      if (pinnedUrls.has(hit.url)) continue
      const list = byKind.get(hit.kind) ?? []
      list.push(hit)
      byKind.set(hit.kind, list)
    }
    if (expanded) {
      const all = await this.#engine.search(typo ?? rewritten, { ...filters, kind: expanded }, 200)
      byKind = new Map(byKind)
      byKind.set(
        expanded,
        all.hits.filter((h) => !pinnedUrls.has(h.url)),
      )
    }
    const groups: Group[] = GROUPS.flatMap(({ kind, label }) => {
      const hits = byKind.get(kind) ?? []
      if (!hits.length) return []
      const total = Math.max(result.counts[kind] ?? 0, hits.length)
      return [{ kind, label, hits: kind === expanded ? hits : hits.slice(0, PER_GROUP), total }]
    })
    const count = pinned.length + groups.reduce((n, g) => n + g.total, 0)
    if (ticket !== this.#last) return undefined
    if (!count) {
      return {
        status: 'none',
        query: q,
        pinned: [],
        groups: [],
        count: 0,
        typo,
        recent: this.recent(),
        popular: await this.popular(),
      }
    }
    return { status: 'results', query: q, pinned, groups, count, typo, recent: [], popular: [] }
  }
}
