// The only module that knows Pagefind. Another engine (DocSearch) is another adapter.
import type { SearchEngine, SearchFilters, SearchHit, SearchKind, SearchResult } from './types.ts'

interface PagefindData {
  readonly url: string
  readonly excerpt: string
  readonly meta: Record<string, string>
  readonly filters: Record<string, string[]>
  readonly sub_results?: readonly {
    readonly url: string
    readonly title: string
    readonly excerpt: string
  }[]
}
interface PagefindResult {
  readonly score: number
  data(): Promise<PagefindData>
}
interface Pagefind {
  options(options: Record<string, unknown>): Promise<void>
  init(): Promise<void>
  search(
    query: string,
    options?: { filters?: Record<string, string> },
  ): Promise<{
    results: PagefindResult[]
    filters: Record<string, Record<string, number>>
    unfilteredResultCount: number
  } | null>
}

const KINDS: readonly SearchKind[] = ['effect', 'guide', 'api', 'error']

/** Pagefind keeps `.html` in URLs of pages built as files; the site serves them without it. */
export const cleanUrl = (url: string): string => url.replace(/\.html(?=$|[#?])/, '')

const flat = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Words of a query as Pagefind compares them: lower case, letters and digits only. */
export const queryWords = (query: string): string[] => query.split(/\s+/).map(flat).filter(Boolean)

/**
 * Whether the excerpts show the query's own words; undefined when only an exact search can tell.
 * Pagefind cuts a word it does not know until a prefix matches, so "zzzzqx" finds every "z" and
 * "transitoin" every "transit…", and the excerpts mark only those shorter words. A marked word
 * that starts with a query word settles it; stemming ("flying" finds "fly") needs the check.
 */
export function showsQuery(query: string, excerpts: readonly string[]): boolean | undefined {
  const words = queryWords(query)
  // A mark covers a whole token such as data-dio="rippel": its parts count too.
  const marked = excerpts.flatMap((html) =>
    [...html.matchAll(/<mark>([^<]*)<\/mark>/g)].flatMap((m) => {
      const text = m[1] ?? ''
      return [flat(text), ...text.split(/[^\p{L}\p{N}]+/u).map(flat)]
    }),
  )
  if (!words.length || !marked.length) return true
  return words.some((w) => marked.some((m) => m.startsWith(w))) ? true : undefined
}

export function pagefindEngine(base = '/pagefind/'): SearchEngine {
  let ready: Promise<Pagefind> | undefined

  const load = (): Promise<Pagefind> => {
    ready ??= (async () => {
      const url = `${base}pagefind.js`
      const pagefind = (await import(/* @vite-ignore */ url)) as Pagefind
      await pagefind.options({
        excerptLength: 24,
        ranking: { termFrequency: 0.8, pageLength: 0.5, termSaturation: 1.2, termSimilarity: 1 },
      })
      await pagefind.init()
      return pagefind
    })()
    ready.catch(() => {
      ready = undefined
    })
    return ready
  }

  return {
    init: async () => {
      await load()
    },
    async search(query: string, filters: SearchFilters, limit = 40): Promise<SearchResult> {
      const pagefind = await load()
      const f: Record<string, string> = {}
      if (filters.kind) f.kind = filters.kind
      if (filters.framework) f.framework = filters.framework
      const found = await pagefind.search(query, { filters: f })
      if (!found) return { hits: [], counts: {}, total: 0 }
      const data = await Promise.all(found.results.slice(0, limit).map((r) => r.data()))
      const hits: SearchHit[] = data.map((d, i) => {
        const kind = (d.filters.kind?.[0] ?? 'guide') as SearchKind
        return {
          url: cleanUrl(d.url),
          title: d.meta.title ?? d.url,
          kind: KINDS.includes(kind) ? kind : 'guide',
          excerpt: d.excerpt,
          sub: (d.sub_results ?? [])
            .filter((s) => cleanUrl(s.url) !== cleanUrl(d.url))
            .slice(0, 3)
            .map((s) => ({ url: cleanUrl(s.url), title: s.title, excerpt: s.excerpt })),
          meta: d.meta,
          score: found.results[i]?.score ?? 0,
        }
      })
      const excerpts = hits.flatMap((h) => [h.excerpt, ...h.sub.map((s) => s.excerpt)])
      // A quoted word is searched as is, stemmed but never cut.
      const exact = async () => {
        for (const word of queryWords(query)) {
          if ((await pagefind.search(`"${word}"`, { filters: f }))?.results.length) return true
        }
        return false
      }
      if (!(showsQuery(query, excerpts) ?? (await exact())))
        return { hits: [], counts: {}, total: 0 }
      const counts: Partial<Record<SearchKind, number>> = {}
      for (const kind of KINDS) {
        const n = found.filters.kind?.[kind]
        if (n) counts[kind] = n
      }
      return { hits, counts, total: found.results.length }
    },
  }
}
