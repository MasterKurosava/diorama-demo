// Query rewriters that run before the engine. Each one is a pure function of the
// query and the search data.
import type { PinnedHit, SearchData } from './types.ts'

export interface Rewrite {
  readonly pinned: readonly PinnedHit[]
  /** What the engine searches for. */
  readonly query: string
  /**
   * Synonym words, searched one by one when the query finds little. Not added to the query: the
   * engine needs every word of a query on the page, so more words would find less.
   */
  readonly also?: readonly string[]
}

const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g

const camel = (kebab: string): string =>
  kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/** A known error code anywhere in the query, also inside a pasted console message. */
export function code(query: string, data: SearchData): Rewrite {
  const pinned: PinnedHit[] = []
  for (const m of query.matchAll(CODE)) {
    const found = data.codes.find((c) => c.code === m[0])
    if (!found || pinned.some((p) => p.url === found.url)) continue
    pinned.push({
      url: found.url,
      title: found.code,
      kind: 'error',
      excerpt: found.summary,
      meta: { level: found.level },
      reason: 'code',
    })
  }
  // A pasted message is noise for the engine: search for the codes alone.
  const words = query.trim().split(/\s+/).length
  return {
    pinned,
    query: pinned.length && words > 3 ? pinned.map((p) => p.title).join(' ') : query,
  }
}

/** `data-dio-<x>`: a reserved attribute, or `<x>` as a param of every effect that has one. */
export function attribute(query: string, data: SearchData): Rewrite {
  const m = /\bdata-dio(?:-([a-z][a-z0-9-]*))?\b/.exec(query)
  if (!m) return { pinned: [], query }
  const rest = m[1]
  if (!rest) {
    return {
      pinned: [
        {
          url: '/docs/api/markup#data-dio',
          title: 'data-dio',
          kind: 'api',
          excerpt: 'Effect names on an element.',
          meta: {},
          reason: 'attribute',
        },
      ],
      query,
    }
  }
  if (data.reserved.includes(rest)) {
    return {
      pinned: [
        {
          url: `/docs/api/markup#data-dio-${rest}`,
          title: `data-dio-${rest}`,
          kind: 'api',
          excerpt: 'Reserved attribute.',
          meta: {},
          reason: 'attribute',
        },
      ],
      query,
    }
  }
  const name = camel(rest)
  const pinned: PinnedHit[] = data.params
    .filter((p) => p.name === name)
    .map((p) => ({
      url: p.url,
      title: `${p.name}`,
      kind: 'effect' as const,
      excerpt: `Param of ${p.effect}.`,
      meta: { effect: p.effect },
      reason: 'attribute' as const,
    }))
  return { pinned, query: query.replace(m[0], name) }
}

/** The exact name of an API symbol, with or without `()`. */
export function symbol(query: string, data: SearchData): Rewrite {
  const name = query.trim().replace(/\(\)$/, '')
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return { pinned: [], query }
  const pinned: PinnedHit[] = data.symbols
    .filter((s) => s.name === name)
    .map((s) => ({
      url: s.url,
      title: s.name,
      kind: 'api' as const,
      excerpt: '',
      meta: { signature: s.signature, module: s.module },
      reason: 'symbol' as const,
    }))
  return { pinned, query: name }
}

const titleOf = (
  url: string,
  data: SearchData,
): { title: string; kind: PinnedHit['kind']; summary: string } => {
  const page = data.pages.find((p) => p.url === url.split('#')[0])
  const sym = data.symbols.find((s) => s.url === url)
  if (sym) return { title: sym.name, kind: 'api', summary: sym.signature }
  return { title: page?.title ?? url, kind: page?.kind ?? 'guide', summary: page?.summary ?? '' }
}

/** Dictionary keys, one or more words, found in the query as a phrase: pages to pin, words to try. */
export function synonyms(query: string, data: SearchData): Rewrite {
  const q = ` ${query.toLowerCase().replace(/\s+/g, ' ').trim()} `
  const pinned: PinnedHit[] = []
  const terms: string[] = []
  for (const [key, entry] of Object.entries(data.synonyms)) {
    if (!q.includes(` ${key} `)) continue
    for (const url of entry.pages) {
      if (pinned.some((p) => p.url === url)) continue
      const { title, kind, summary } = titleOf(url, data)
      pinned.push({ url, title, kind, excerpt: summary, meta: {}, reason: 'synonym' })
    }
    terms.push(...entry.terms)
  }
  return { pinned, query, also: [...new Set(terms)] }
}

// Params of effects without a page yet share their module's URL; each effect keeps its pin.
const pinKey = (p: PinnedHit): string => `${p.url} ${p.meta.effect ?? ''}`

/** All rewriters in order; earlier pins come first, duplicates are dropped. */
export function rewrite(query: string, data: SearchData): Rewrite {
  let current = query
  const pinned: PinnedHit[] = []
  const also: string[] = []
  for (const step of [code, attribute, symbol, synonyms]) {
    const r = step(current, data)
    for (const p of r.pinned) if (!pinned.some((x) => pinKey(x) === pinKey(p))) pinned.push(p)
    also.push(...(r.also ?? []))
    current = r.query
  }
  return { pinned, query: current, also }
}
