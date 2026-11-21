// Pagefind index for `astro dev`, where no built HTML exists. Pages are approximated from their
// sources (MDX text, error frontmatter, the API data) with the same filters and metadata as the
// built pages, so every page is findable while writing. `astro build` indexes the real HTML.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import GithubSlugger from 'github-slugger'
import { codeSlug } from '../lib/links.ts'

const FRAMEWORKS = ['vite', 'astro', 'nuxt', 'next', 'html']

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.mdx?$/.test(name) ? [path] : []
  })
}

/** Flat YAML frontmatter: strings, numbers, booleans and `[a, b]` lists. */
export function frontmatter(text: string): {
  data: Record<string, string | string[]>
  body: string
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { data: {}, body: text }
  const data: Record<string, string | string[]> = {}
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!kv?.[1]) continue
    const raw = (kv[2] ?? '').trim()
    const unquote = (v: string) =>
      v
        .trim()
        .replace(/^'(.*)'$/s, (_, s: string) => s.replaceAll("''", "'"))
        .replace(/^"(.*)"$/s, '$1')
    data[kv[1]] = raw.startsWith('[')
      ? raw.slice(1, -1).split(',').map(unquote).filter(Boolean)
      : unquote(raw)
  }
  return { data, body: text.slice(m[0].length) }
}

const inline = (s: string): string =>
  esc(
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, ''),
  )

/** MDX body to indexable HTML: headings keep the ids Astro gives them, code gets a low weight. */
export function bodyHtml(body: string): string {
  const slugger = new GithubSlugger()
  const out: string[] = []
  let fence: string[] | undefined
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fence) {
        out.push(`<pre data-pagefind-weight="0.25">${esc(fence.join('\n'))}</pre>`)
        fence = undefined
      } else fence = []
      continue
    }
    if (fence) {
      fence.push(line)
      continue
    }
    if (/^(import|export)\s/.test(line)) continue
    const h = /^(#{2,4})\s+(.*)$/.exec(line)
    if (h) {
      const text = (h[2] ?? '').replace(/[*_`]/g, '')
      out.push(`<h${h[1]?.length} id="${slugger.slug(text)}">${esc(text)}</h${h[1]?.length}>`)
      continue
    }
    // Attribute values of components (label, title, description) are readable text too.
    const attrs = [...line.matchAll(/\b(?:label|title|description|caption)="([^"]+)"/g)]
      .map((a) => a[1])
      .join(' ')
    const text = inline(line).trim()
    if (text || attrs) out.push(`<p>${text} ${esc(attrs)}</p>`)
  }
  return out.join('\n')
}

export interface DevRecord {
  readonly url: string
  readonly html: string
}

function page(opts: {
  url: string
  title: string
  summary: string
  kind: string
  body: string
  frameworks?: readonly string[]
  meta?: Record<string, string>
}): DevRecord {
  const filters = [
    `kind:${opts.kind}`,
    ...(opts.frameworks?.length ? opts.frameworks : FRAMEWORKS).map((f) => `framework:${f}`),
  ]
  if (opts.meta?.module) filters.push(`module:${opts.meta.module}`)
  const hidden = [
    ...filters.map((f) => `<span hidden data-pagefind-filter="${esc(f)}"></span>`),
    ...Object.entries({ ...opts.meta, summary: opts.summary }).map(
      ([k, v]) => `<span hidden data-pagefind-meta="${esc(`${k}:${v}`)}"></span>`,
    ),
  ].join('')
  return {
    url: opts.url,
    html: `<!doctype html><html lang="en"><head><title>${esc(opts.title)}</title></head><body><main data-pagefind-body>${hidden}<h1>${esc(opts.title)}</h1><p>${esc(opts.summary)}</p>${opts.body}</main></body></html>`,
  }
}

interface ApiLite {
  readonly modules: readonly {
    readonly slug: string
    readonly specifier: string
    readonly summary: string
    readonly symbols: readonly number[]
  }[]
  readonly symbols: readonly {
    readonly name: string
    readonly kind: string
    readonly specifier: string
    readonly url: string
    readonly summary: string
    readonly signature: string
    readonly members: readonly { readonly name: string; readonly summary: string }[]
  }[]
}

export function devRecords(root: string): DevRecord[] {
  const records: DevRecord[] = []
  const docsDir = join(root, 'src/content/docs')
  for (const file of walk(docsDir)) {
    const { data, body } = frontmatter(readFileSync(file, 'utf8'))
    if (data.draft === 'true') continue
    const id = relative(docsDir, file)
      .replaceAll('\\', '/')
      .replace(/\.mdx?$/, '')
      .replace(/(^|\/)index$/, '')
    const kind = data.section === 'api' ? 'api' : 'guide'
    records.push(
      page({
        url: id ? `/docs/${id}` : '/docs',
        title: String(data.title ?? id),
        summary: String(data.description ?? ''),
        kind,
        body: bodyHtml(body),
        frameworks: Array.isArray(data.frameworks) ? data.frameworks : undefined,
      }),
    )
  }

  const effectsDir = join(root, 'src/content/effects')
  for (const file of walk(effectsDir)) {
    const { data, body } = frontmatter(readFileSync(file, 'utf8'))
    const name = relative(effectsDir, file).replace(/\.mdx?$/, '')
    records.push(
      page({
        url: `/docs/effects/${name}`,
        title: name,
        summary: String(data.description ?? ''),
        kind: 'effect',
        body: bodyHtml(body),
      }),
    )
  }

  const generated = (name: string) => join(root, 'src/generated', name)
  const specifiers = new Map<string, string>(
    existsSync(generated('errors.json'))
      ? (
          JSON.parse(readFileSync(generated('errors.json'), 'utf8')) as {
            code: string
            specifier: string
          }[]
        ).map((c) => [c.code, c.specifier])
      : [],
  )
  for (const file of walk(join(root, 'src/content/errors'))) {
    const { data, body } = frontmatter(readFileSync(file, 'utf8'))
    const code = String(data.code ?? '')
    if (!specifiers.has(code)) continue
    const message = `<pre data-pagefind-weight="8">${esc(`${code}: ${data.message ?? ''}`)}</pre>`
    records.push(
      page({
        url: `/docs/errors/${codeSlug(code)}`,
        title: code,
        summary: String(data.summary ?? ''),
        kind: 'error',
        body: message + bodyHtml(body),
        meta: { level: String(data.level ?? ''), module: specifiers.get(code) ?? '' },
      }),
    )
  }

  if (existsSync(generated('api.json'))) {
    const data = JSON.parse(readFileSync(generated('api.json'), 'utf8')) as ApiLite
    for (const m of data.modules) {
      if (!m.symbols.length) continue
      records.push(
        page({
          url: `/docs/api/${m.slug}`,
          title: m.specifier,
          summary: m.summary,
          kind: 'api',
          body: '',
          meta: { module: m.specifier },
        }),
      )
    }
    for (const s of data.symbols) {
      const members = s.members
        .map((m) => `<h3 id="${esc(m.name)}">${esc(m.name)}</h3><p>${esc(m.summary)}</p>`)
        .join('')
      records.push(
        page({
          url: s.url,
          title: s.name,
          summary: s.summary.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ') ?? '',
          kind: 'api',
          body: `<pre data-pagefind-weight="5">${esc(s.signature)}</pre><p>${esc(s.summary)}</p>${members}`,
          meta: { module: s.specifier, signature: s.signature.slice(0, 160) },
        }),
      )
    }
  }
  return records
}

const TYPES: Record<string, string> = {
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  wasm: 'application/wasm',
}

type Middleware = (
  req: { url?: string },
  res: {
    setHeader(k: string, v: string): void
    end(body?: Uint8Array | string): void
    statusCode: number
  },
  next: () => void,
) => void

/** Serves /pagefind/* from an in-memory index, rebuilt after content changes. */
export function devPagefind(
  root: string,
  log: (message: string) => void,
): { middleware: Middleware; invalidate: () => void } {
  let files: Promise<Map<string, Uint8Array>> | undefined
  const build = async (): Promise<Map<string, Uint8Array>> => {
    const started = Date.now()
    const pagefind = await import('pagefind')
    const { index, errors } = await pagefind.createIndex({})
    if (!index) throw new Error(`Pagefind: ${errors.join(', ')}`)
    const records = devRecords(root)
    for (const r of records) {
      const added = await index.addHTMLFile({ url: r.url, content: r.html })
      if (added.errors.length) log(`pagefind: ${r.url}: ${added.errors.join(', ')}`)
    }
    const out = await index.getFiles()
    await index.deleteIndex()
    log(`pagefind (dev, from sources): ${records.length} pages in ${Date.now() - started} ms`)
    return new Map(out.files.map((f) => [f.path.replaceAll('\\', '/'), f.content]))
  }
  return {
    invalidate: () => {
      files = undefined
    },
    middleware: (req, res, next) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '')
      files ??= build()
      files.then(
        (map) => {
          const body = map.get(path)
          if (!body) return next()
          res.statusCode = 200
          res.setHeader(
            'Content-Type',
            TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
          )
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        },
        (error: Error) => {
          files = undefined
          log(`pagefind (dev): ${error.message}`)
          next()
        },
      )
    },
  }
}
