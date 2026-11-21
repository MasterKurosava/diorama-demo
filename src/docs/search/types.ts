import type { Framework } from '../lib/commands.ts'

export type SearchKind = 'effect' | 'guide' | 'api' | 'error'

export interface SearchFilters {
  readonly kind?: SearchKind
  readonly framework?: Framework
}

export interface SubHit {
  readonly url: string
  readonly title: string
  readonly excerpt: string
}

export interface SearchHit {
  readonly url: string
  readonly title: string
  readonly kind: SearchKind
  /** HTML with <mark> around matched words. */
  readonly excerpt: string
  /** Matches under headings of the page, in page order. */
  readonly sub: readonly SubHit[]
  /** signature, module, poster, clip from data-pagefind-meta. */
  readonly meta: Readonly<Record<string, string>>
  readonly score: number
}

export interface SearchResult {
  readonly hits: readonly SearchHit[]
  /** Results per kind across the whole index, not only the loaded hits. */
  readonly counts: Readonly<Partial<Record<SearchKind, number>>>
  readonly total: number
}

export interface SearchEngine {
  /** Loads the engine; called on intent (hover or focus of the search button, the shortcut). */
  init(): Promise<void>
  search(query: string, filters: SearchFilters, limit?: number): Promise<SearchResult>
}

/** A result found before the engine: exact code, attribute, symbol or synonym. */
export interface PinnedHit extends Omit<SearchHit, 'score' | 'sub'> {
  readonly reason: 'code' | 'attribute' | 'symbol' | 'synonym' | 'typo'
}

/** src/generated search data, served as /docs/search-data.json. */
export interface SearchData {
  readonly codes: readonly {
    readonly code: string
    readonly url: string
    readonly level: string
    readonly summary: string
  }[]
  readonly reserved: readonly string[]
  readonly params: readonly {
    readonly effect: string
    readonly name: string
    readonly url: string
  }[]
  readonly symbols: readonly {
    readonly name: string
    readonly url: string
    readonly kind: string
    readonly module: string
    readonly signature: string
  }[]
  readonly pages: readonly {
    readonly url: string
    readonly title: string
    readonly kind: SearchKind
    readonly summary: string
  }[]
  readonly synonyms: Readonly<
    Record<string, { readonly pages: readonly string[]; readonly terms: readonly string[] }>
  >
  readonly popular: readonly string[]
  /** Words for typo correction: effect names, symbols, glossary, synonym keys. */
  readonly words: readonly string[]
}
