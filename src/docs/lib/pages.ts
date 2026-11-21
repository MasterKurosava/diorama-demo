// Every docs page with its place: sidebar, breadcrumbs, prev/next, llms.txt, search data.
import { type CollectionEntry, getCollection } from 'astro:content'
import { api, isType, moduleSymbols } from './api.ts'
import { effectPages } from './effect-pages.ts'
import { byCategory } from './effects.ts'

export type Section = CollectionEntry<'docs'>['data']['section']

export const SECTIONS: readonly { readonly id: Section; readonly label: string }[] = [
  { id: 'start', label: 'Getting started' },
  { id: 'learn', label: 'Learn' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'guides', label: 'Guides' },
  { id: 'effects', label: 'Effects' },
  { id: 'api', label: 'API' },
  { id: 'examples', label: 'Examples' },
]

export interface DocPage {
  readonly url: string
  readonly title: string
  readonly label: string
  readonly description: string
  readonly section: Section
  readonly order: number
  readonly entry: CollectionEntry<'docs'>
}

export const urlOfEntry = (id: string): string => {
  const path = id.replace(/(^|\/)index$/, '')
  return path ? `/docs/${path}` : '/docs'
}

export async function docPages(): Promise<DocPage[]> {
  const entries = await getCollection('docs', (e) => !e.data.draft)
  return entries
    .map((entry) => ({
      url: urlOfEntry(entry.id),
      title: entry.data.title,
      label: entry.data.label ?? entry.data.title,
      description: entry.data.description,
      section: entry.data.section,
      order: entry.data.order,
      entry,
    }))
    .sort(
      (a, b) =>
        SECTIONS.findIndex((s) => s.id === a.section) -
          SECTIONS.findIndex((s) => s.id === b.section) || a.order - b.order,
    )
}

export interface NavLink {
  readonly label: string
  readonly href: string
  readonly code?: boolean
  /** The page is about this framework only, as the install pages are. */
  readonly framework?: string
}
export interface NavGroup {
  readonly id: string
  readonly label: string
  readonly links: readonly NavLink[]
  readonly groups?: readonly NavGroup[]
  /** Small headings inside a group: Functions, Types. */
  readonly parts?: readonly { readonly label: string; readonly links: readonly NavLink[] }[]
  readonly href?: string
  readonly open?: boolean
  /** Links after the nested groups: Quality after the effect categories. */
  readonly tail?: readonly NavLink[]
}

function apiGroups(current: string, handwritten: readonly DocPage[]): NavGroup {
  const modules = api().modules.filter((m) => m.symbols.length)
  const moduleGroup = (slug: string): NavGroup => {
    const mod = modules.find((m) => m.slug === slug)
    if (!mod) throw new Error(`no module ${slug}`)
    const href = `/docs/api/${mod.slug}`
    const inside = current === href || current.startsWith(`${href}/`)
    const syms = inside ? moduleSymbols(mod).filter((s) => s.module === mod.slug) : []
    const links = (list: typeof syms) =>
      list
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ label: s.name, href: s.url, code: true }))
    return {
      id: `api-${mod.slug}`,
      label: mod.specifier,
      href,
      links: [],
      open: inside,
      parts: inside
        ? [
            { label: 'Functions and values', links: links(syms.filter((s) => !isType(s))) },
            { label: 'Types', links: links(syms.filter(isType)) },
          ].filter((p) => p.links.length)
        : [],
    }
  }
  const high = modules.filter((m) => !m.lowLevel).map((m) => moduleGroup(m.slug))
  const low = modules.filter((m) => m.lowLevel).map((m) => moduleGroup(m.slug))
  return {
    id: 'api',
    label: 'API',
    links: [
      { label: 'Overview', href: '/docs/api' },
      ...handwritten.map((p) => ({ label: p.label, href: p.url })),
    ],
    groups: [
      ...high,
      { id: 'api-low', label: 'Low level', links: [], groups: low, open: low.some((g) => g.open) },
    ],
    open: current.startsWith('/docs/api'),
  }
}

/** Gallery, the effects by category, Quality. */
async function effectsGroup(current: string, handwritten: readonly DocPage[]): Promise<NavGroup> {
  const categories = byCategory((await effectPages()).map((p) => p.info))
  return {
    id: 'effects',
    label: 'Effects',
    links: [{ label: 'Gallery', href: '/docs/effects' }],
    groups: categories.map((c) => ({
      id: `effects-${c.slug}`,
      label: c.title,
      links: c.effects.map((e) => ({ label: e.name, href: e.url, code: true })),
      open: c.effects.some((e) => e.url === current),
    })),
    tail: handwritten.map((p) => ({ label: p.label, href: p.url })),
    open: current === '/docs/effects' || current.startsWith('/docs/effects/'),
  }
}

export async function sidebar(current: string): Promise<NavGroup[]> {
  const pages = await docPages()
  const groups: NavGroup[] = []
  for (const section of SECTIONS) {
    const list = pages.filter((p) => p.section === section.id)
    if (section.id === 'effects') {
      groups.push(await effectsGroup(current, list))
      continue
    }
    if (section.id === 'api') {
      groups.push(apiGroups(current, list))
      // Errors sit between API and Examples.
      groups.push({
        id: 'errors',
        label: 'Errors',
        links: [{ label: 'All errors', href: '/docs/errors' }],
        open: current.startsWith('/docs/errors'),
      })
      continue
    }
    if (!list.length) continue
    groups.push({
      id: section.id,
      label: section.label,
      links: list.map((p) => ({ label: p.label, href: p.url, framework: soleFramework(p) })),
      open: list.some((p) => p.url === current),
    })
  }
  return groups
}

const soleFramework = (p: DocPage): string | undefined =>
  p.entry.data.frameworks?.length === 1 ? p.entry.data.frameworks[0] : undefined

/**
 * Where the framework select leads from the current page: a page about one framework has siblings
 * in its section for the others (Install with Vite, Install with Astro…). Empty on other pages.
 */
export async function frameworkPages(current: string): Promise<Record<string, string>> {
  const pages = await docPages()
  const page = pages.find((p) => p.url === current)
  if (!page || !soleFramework(page)) return {}
  const out: Record<string, string> = {}
  for (const p of pages) {
    const f = p.section === page.section ? soleFramework(p) : undefined
    if (f && !out[f]) out[f] = p.url
  }
  return out
}

/** Prev/next inside a section; the end of one reading section leads to the next one. */
export async function prevNext(current: string): Promise<{ prev?: DocPage; next?: DocPage }> {
  const pages = (await docPages()).filter((p) => ['start', 'learn', 'concepts'].includes(p.section))
  const i = pages.findIndex((p) => p.url === current)
  if (i < 0) return {}
  return { prev: pages[i - 1], next: pages[i + 1] }
}

export function sectionLabel(section: Section): string {
  return SECTIONS.find((s) => s.id === section)?.label ?? 'Docs'
}

export function sectionHref(section: Section, pages: readonly DocPage[]): string | undefined {
  if (section === 'effects') return '/docs/effects'
  return pages.find((p) => p.section === section)?.url
}
