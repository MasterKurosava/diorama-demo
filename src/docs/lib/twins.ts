// Markdown of every docs page: the .md twins, llms-full.txt and llms-api.txt.
import { render } from 'astro:content'
import { REPO, REPO_REF } from '../site.ts'
import { api, isType, moduleSymbols, symbolMarkdown } from './api.ts'
import { effectPages } from './effect-pages.ts'
import { byCategory, effectMarkdown, GALLERY, relatedEffects, sourceUrl } from './effects.ts'
import { consoleLine, errorPages } from './errors.ts'
import { moduleSummary } from './modules.ts'
import { docPages, SECTIONS, urlOfEntry } from './pages.ts'
import { load } from './tables.ts'
import { exampleMarkdown } from './twin.ts'

export interface Twin {
  readonly url: string
  readonly title: string
  readonly description: string
  /** Where llms.txt lists it. */
  readonly group: string
  readonly markdown: string
}

const page = (title: string, description: string, body: string): string =>
  `# ${title}\n\n${description}\n\n${body.trim()}\n`

export async function twins(): Promise<Twin[]> {
  const out: Twin[] = []
  for (const p of await docPages()) {
    const { remarkPluginFrontmatter } = await render(p.entry)
    const body = String(remarkPluginFrontmatter.markdown ?? '')
    const group =
      p.section === 'home' ? 'Docs' : (SECTIONS.find((s) => s.id === p.section)?.label ?? 'Docs')
    out.push({
      url: p.url,
      title: p.title,
      description: p.description,
      group,
      markdown: page(p.title, p.description, body),
    })
  }

  out.push(...(await effectTwins()))

  const data = api()
  const modules = data.modules.filter((m) => m.symbols.length)
  out.push({
    url: '/docs/api',
    title: 'API reference',
    description:
      'Every attribute, input and export of Diorama, generated from the library sources.',
    group: 'API',
    markdown: page(
      'API reference',
      'Every attribute, input and export of Diorama, generated from the library sources.',
      modules
        .map(
          (m) =>
            `- [${m.specifier}](/docs/api/${m.slug}.md): ${moduleSummary(m.slug, m.specifier)}`,
        )
        .join('\n'),
    ),
  })
  for (const m of modules) {
    const syms = moduleSymbols(m).sort((a, b) => a.name.localeCompare(b.name))
    const list = (types: boolean) =>
      syms
        .filter((s) => isType(s) === types)
        .map(
          (s) =>
            `- [${s.name}](${s.url}.md)${s.summary ? `: ${s.summary.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ')}` : ''}`,
        )
        .join('\n')
    const values = list(false)
    const types = list(true)
    const body = [values && `## Functions and values\n\n${values}`, types && `## Types\n\n${types}`]
      .filter(Boolean)
      .join('\n\n')
    out.push({
      url: `/docs/api/${m.slug}`,
      title: m.specifier,
      description: moduleSummary(m.slug, m.specifier),
      group: 'API',
      markdown: page(m.specifier, moduleSummary(m.slug, m.specifier), body),
    })
  }
  for (const s of data.symbols) {
    out.push({
      url: s.url,
      title: s.name,
      description: s.signature,
      group: 'API symbols',
      markdown: symbolMarkdown(s),
    })
  }

  const errors = await errorPages()
  out.push({
    url: '/docs/errors',
    title: 'Errors',
    description: 'Every code Diorama prints in the console, what it means and how to fix it.',
    group: 'Errors',
    markdown: page(
      'Errors',
      'Every code Diorama prints in the console, what it means and how to fix it.',
      errors.map((e) => `- [${e.info.code}](${e.url}.md): ${e.entry.data.summary}`).join('\n'),
    ),
  })
  for (const e of errors) {
    const { remarkPluginFrontmatter } = await render(e.entry)
    const d = e.entry.data
    const body = `${d.level} in \`${e.info.specifier}\`\n\n\`\`\`text\n${consoleLine(d.code, d.message)}\n\`\`\`\n\n${String(remarkPluginFrontmatter.markdown ?? '')}`
    out.push({
      url: e.url,
      title: d.code,
      description: d.summary,
      group: 'Errors',
      markdown: page(d.code, d.summary, body),
    })
  }
  return out
}

/** The gallery and one twin per effect page. */
async function effectTwins(): Promise<Twin[]> {
  const pages = await effectPages()
  const all = pages.map((p) => p.info)
  const docs = await docPages()
  const shaderInputs = new Set(load().tables.inputs)
  const gallery = byCategory(all)
    .map((c) => {
      const items = c.effects.map((e) => `- [${e.name}](${e.url}.md): ${e.meta.summary}`)
      return `## ${c.title}\n\n${c.blurb}\n\n${items.join('\n')}`
    })
    .join('\n\n')
  const out: Twin[] = [
    {
      url: '/docs/effects',
      title: GALLERY.title,
      description: GALLERY.description,
      group: 'Effects',
      markdown: page(GALLERY.title, GALLERY.description, gallery),
    },
  ]
  for (const p of pages) {
    const { remarkPluginFrontmatter } = await render(p.entry)
    const guides = (p.entry.data.related ?? []).map((id) => {
      const url = urlOfEntry(id.replace(/^\/?docs\//, '').replace(/^\//, ''))
      return { url, label: docs.find((d) => d.url === url)?.title ?? id }
    })
    const description = p.entry.data.example?.description ?? p.info.meta.summary
    out.push({
      url: p.info.url,
      title: p.info.name,
      description: p.info.meta.summary,
      group: 'Effects',
      markdown: effectMarkdown(p.info, {
        // The markup is the usage; the example's own script only drives the preview.
        example: p.example
          ? exampleMarkdown(p.example, description, (n) => n === 'index.html')
          : '',
        body: String(remarkPluginFrontmatter.markdown ?? ''),
        shaderInputs,
        related: relatedEffects(p.info, all),
        guides,
        source: sourceUrl(p.info.meta, REPO, REPO_REF),
      }),
    })
  }
  return out
}

export const markdownResponse = (text: string): Response =>
  new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
