// Checks on the built site: links and anchors, path case, Markdown twins, llms.txt, error
// codes and pages, the synonym dictionary.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface Site {
  /** '/docs/start/vite' to the HTML of that page. */
  readonly pages: ReadonlyMap<string, string>
  /** '/docs/start/vite.md' to its text. */
  readonly twins: ReadonlyMap<string, string>
  readonly files: readonly string[]
}

function list(dir: string, base = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) list(path, base, out)
    else out.push(relative(base, path).replaceAll('\\', '/'))
  }
  return out
}

export function readSite(dist: string): Site {
  const files = list(dist)
  const pages = new Map<string, string>()
  const twins = new Map<string, string>()
  for (const file of files) {
    if (file.endsWith('.html')) {
      const url = `/${file.replace(/\.html$/, '').replace(/(^|\/)index$/, '')}`
      pages.set(url === '/' ? '/' : url.replace(/\/$/, ''), readFileSync(join(dist, file), 'utf8'))
    } else if (file.endsWith('.md') || file.endsWith('.txt')) {
      twins.set(`/${file}`, readFileSync(join(dist, file), 'utf8'))
    }
  }
  return { pages, twins, files }
}

const ids = (html: string): Set<string> =>
  new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? ''))

/** Internal links under /docs point at built pages and existing anchors. */
export function checkLinks(site: Site): string[] {
  const problems: string[] = []
  const anchors = new Map<string, Set<string>>()
  for (const [url, html] of site.pages) {
    if (!url.startsWith('/docs')) continue
    // Search results and the sandbox build links at runtime; their hrefs here are templates.
    const body = html.replace(/<template[\s\S]*?<\/template>/g, '')
    for (const m of body.matchAll(/\shref="([^"]+)"/g)) {
      const href = (m[1] ?? '').replaceAll('&amp;', '&')
      if (!(href.startsWith('/') || href.startsWith('#')) || href.startsWith('//')) continue
      const [path = '', hash] = href.split('#')
      const target = path === '' ? url : path.replace(/\?.*$/, '')
      // An empty fragment is "top of the page", always valid.
      if (path === '' && !hash) continue
      if (
        target.startsWith('/_astro') ||
        target.startsWith('/pagefind') ||
        target.startsWith('/fonts')
      )
        continue
      if (!target.startsWith('/docs') && !target.startsWith('/llms')) continue
      if (/\.(md|txt|json)$/.test(target)) {
        if (!site.twins.has(target) && !site.files.includes(target.slice(1)))
          problems.push(`${url}: ${href} does not exist`)
        continue
      }
      const page = site.pages.get(target)
      if (!page) {
        problems.push(`${url}: ${href} does not exist`)
        continue
      }
      if (!hash) continue
      let set = anchors.get(target)
      if (!set) {
        set = ids(page)
        anchors.set(target, set)
      }
      if (!set.has(decodeURIComponent(hash))) problems.push(`${url}: ${href} has no anchor`)
    }
  }
  return problems
}

/** Lowercase kebab paths, unique without case. */
export function checkPaths(site: Site): string[] {
  const problems: string[] = []
  const seen = new Map<string, string>()
  for (const file of site.files) {
    if (!file.startsWith('docs')) continue
    if (!/^[a-z0-9/.-]+$/.test(file)) problems.push(`${file}: not lowercase kebab`)
    const key = file.toLowerCase()
    if (seen.has(key)) problems.push(`${file} and ${seen.get(key)} differ only in case`)
    seen.set(key, file)
  }
  return problems
}

/** A twin next to every docs page, free of component tags, code fences with a language. */
export function checkTwins(site: Site): string[] {
  const problems: string[] = []
  for (const url of site.pages.keys()) {
    if (!url.startsWith('/docs') || url === '/docs/404') continue
    const twin = site.twins.get(`${url}.md`)
    if (twin === undefined) {
      problems.push(`${url}: no ${url}.md`)
      continue
    }
    const prose = twin.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    const tag = /<\/?[A-Z][A-Za-z]*[\s/>]/.exec(prose)
    if (tag) problems.push(`${url}.md: component tag ${tag[0].trim()}`)
    // Opening and closing fences alternate; only opening ones carry the language.
    const fences = [...twin.matchAll(/^```(.*)$/gm)].map((m) => m[1] ?? '')
    fences.forEach((info, i) => {
      if (i % 2 === 0 && !info.trim()) problems.push(`${url}.md: code block without a language`)
    })
  }
  return problems
}

/** llms.txt follows llmstxt.org and lists every guide-like page. */
export function checkLlms(site: Site): string[] {
  const llms = site.twins.get('/llms.txt')
  if (!llms) return ['/llms.txt is missing']
  const problems: string[] = []
  if (!/^# .+\n\n> .+/.test(llms)) problems.push('llms.txt: needs "# Title" and a "> summary" line')
  for (const url of site.pages.keys()) {
    if (!url.startsWith('/docs') || url === '/docs/404') continue
    if (/^\/docs\/api\/[^/]+\/./.test(url)) continue
    if (!llms.includes(`${url}.md)`)) problems.push(`llms.txt does not list ${url}.md`)
  }
  return problems
}

export interface CodeInfo {
  readonly code: string
}

/** Every code has a page and every page a code; pending codes are listed by hand. */
export function checkErrorPages(
  codes: readonly CodeInfo[],
  pages: readonly string[],
  pending: readonly string[],
): string[] {
  const problems: string[] = []
  const known = new Set(codes.map((c) => c.code))
  const paged = new Set(pages)
  for (const code of known) {
    if (!paged.has(code) && !pending.includes(code)) problems.push(`${code} has no page`)
    if (paged.has(code) && pending.includes(code))
      problems.push(`${code} has a page: remove it from the pending list`)
  }
  for (const page of paged)
    if (!known.has(page)) problems.push(`page ${page} names no code of the library`)
  for (const code of pending)
    if (!known.has(code)) problems.push(`pending ${code} is not a code of the library`)
  return problems
}

/** The constant parts of a documented message occur in the library sources. */
export function checkMessage(message: string, sources: string): string[] {
  const parts = message
    .split(/\{[^}]+\}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4)
  return parts
    .filter((p) => !sources.includes(p))
    .map((p) => `"${p}" is not in the library sources`)
}

/** The TypeScript sources of the given package folders (npm packages ship their src too). */
export function librarySources(dirs: readonly string[]): string {
  const chunks: string[] = []
  for (const dir of dirs) {
    const src = join(dir, 'src')
    if (!existsSync(src)) continue
    for (const file of list(src))
      if (file.endsWith('.ts')) chunks.push(readFileSync(join(src, file), 'utf8'))
  }
  return chunks.join('\n')
}

/** Every page a synonym pins exists. */
export function checkSynonyms(
  synonyms: Record<string, { pages: readonly string[] }>,
  site: Site,
): string[] {
  const problems: string[] = []
  for (const [key, entry] of Object.entries(synonyms)) {
    for (const page of entry.pages) {
      const [path = '', hash] = page.split('#')
      const html = site.pages.get(path)
      if (!html) problems.push(`synonym "${key}": ${page} does not exist`)
      else if (hash && !ids(html).has(hash))
        problems.push(`synonym "${key}": ${page} has no anchor`)
    }
  }
  return problems
}
