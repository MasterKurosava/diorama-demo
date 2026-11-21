import type { APIRoute } from 'astro'
import { api } from '../../docs/lib/api.ts'
import { effectPages as effectEntries } from '../../docs/lib/effect-pages.ts'
import { GALLERY } from '../../docs/lib/effects.ts'
import { errorPages } from '../../docs/lib/errors.ts'
import { docPages } from '../../docs/lib/pages.ts'
import { effectPages, load, unionMembers } from '../../docs/lib/tables.ts'
import popular from '../../docs/search/popular.json'
import synonyms from '../../docs/search/synonyms.json'
import type { SearchData } from '../../docs/search/types.ts'

// Glossary words for typo correction.
const GLOSSARY = [
  'effect',
  'instance',
  'handle',
  'param',
  'option',
  'input',
  'layer',
  'surface',
  'canvas',
  'markup',
  'attribute',
  'flight',
  'copy',
  'transition',
  'module',
  'plugin',
  'reduced',
  'motion',
  'touch',
  'quality',
  'webgpu',
  'webgl',
  'three',
  'shader',
  'texture',
  'pointer',
  'hover',
  'scroll',
  'progress',
  'install',
]

export const GET: APIRoute = async () => {
  const data = api()
  const { effects } = load()
  const paged = effectPages(effects)
  // Until an effect has its page, its params point at the module of the effect.
  const paramUrl = (e: { name: string; package?: string }, param: string) =>
    paged.has(e.name)
      ? `/docs/effects/${e.name}#param-${param}`
      : `/docs/api/${(e.package ?? '').replace('@dioramajs/', '')}`
  const pages = await docPages()
  const errors = await errorPages()
  const effectList = await effectEntries()
  const symbols = data.symbols.map((s) => ({
    name: s.name,
    url: s.url,
    kind: s.kind,
    module: s.specifier,
    signature: s.signature.slice(0, 120),
  }))
  const out: SearchData = {
    codes: errors.map((e) => ({
      code: e.info.code,
      url: e.url,
      level: e.entry.data.level,
      summary: e.entry.data.summary,
    })),
    reserved: unionMembers(data as never, 'ReservedAttr'),
    params: effects.effects.flatMap((e) =>
      e.params.map((p) => ({ effect: e.name, name: p.name, url: paramUrl(e, p.name) })),
    ),
    symbols,
    pages: [
      ...pages.map((p) => ({
        url: p.url,
        title: p.title,
        kind: 'guide' as const,
        summary: p.description,
      })),
      {
        url: '/docs/effects',
        title: GALLERY.title,
        kind: 'effect' as const,
        summary: GALLERY.description,
      },
      ...effectList.map((p) => ({
        url: p.info.url,
        title: p.info.name,
        kind: 'effect' as const,
        summary: p.info.meta.summary,
      })),
      { url: '/docs/api', title: 'API reference', kind: 'api' as const, summary: '' },
      ...data.modules.map((m) => ({
        url: `/docs/api/${m.slug}`,
        title: m.specifier,
        kind: 'api' as const,
        summary: '',
      })),
      { url: '/docs/errors', title: 'Errors', kind: 'error' as const, summary: '' },
    ],
    synonyms,
    popular,
    words: [
      ...new Set([
        ...effects.effects.map((e) => e.name),
        ...symbols.map((s) => s.name),
        ...GLOSSARY,
        ...Object.keys(synonyms).filter((k) => !k.includes(' ')),
      ]),
    ],
  }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } })
}
