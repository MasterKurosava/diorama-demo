// Astro integration of the docs: checks the built site and writes the Pagefind index.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkErrorPages,
  checkLinks,
  checkLlms,
  checkMessage,
  checkPaths,
  checkSynonyms,
  checkTwins,
  librarySources,
  readSite,
} from './checks.ts'
import pending from './errors-pending.json' with { type: 'json' }
import { installedLibrary } from './lib/library.ts'
import { setStrict } from './lib/strict.ts'
import { load } from './lib/tables.ts'
import { devPagefind } from './search/dev-index.ts'
import synonyms from './search/synonyms.json' with { type: 'json' }

interface Logger {
  info(message: string): void
  warn(message: string): void
}

interface DevServer {
  readonly middlewares: {
    use(path: string, handler: ReturnType<typeof devPagefind>['middleware']): void
  }
  readonly watcher: { on(event: 'all', listener: (event: string, path: string) => void): void }
}

function fail(title: string, problems: string[]): void {
  if (!problems.length) return
  throw new Error(
    `${title}\n  ${problems.slice(0, 40).join('\n  ')}${problems.length > 40 ? `\n  …and ${problems.length - 40} more` : ''}`,
  )
}

function errorPages(root: string): { code: string; message: string }[] {
  const dir = join(root, 'src/content/errors')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => {
      const text = readFileSync(join(dir, f), 'utf8')
      const code = /^code:\s*(\S+)/m.exec(text)?.[1] ?? f
      const message =
        /^message:\s*'((?:[^']|'')*)'|^message:\s*"((?:[^"\\]|\\.)*)"|^message:\s*(.+)$/m.exec(text)
      return {
        code,
        message: (message?.[1] ?? message?.[2] ?? message?.[3] ?? '').replaceAll("''", "'"),
      }
    })
}

export function docs() {
  return {
    name: 'diorama-docs',
    hooks: {
      'astro:config:setup': ({ command, logger }: { command: string; logger: Logger }) => {
        setStrict(command === 'build')
        const { linker } = load()
        if (linker.ambiguous.length) {
          logger.info(
            `inline code not linked, ambiguous: ${linker.ambiguous.join(', ')} (add to src/docs/lib/aliases.json)`,
          )
        }
      },
      'astro:server:setup': ({ server, logger }: { server: DevServer; logger: Logger }) => {
        const dev = devPagefind(process.cwd(), (m) => logger.info(m))
        server.middlewares.use('/pagefind', dev.middleware)
        server.watcher.on('all', (_event, path) => {
          if (/[\\/]src[\\/](content|generated)[\\/]/.test(path)) dev.invalidate()
        })
      },
      'astro:build:done': async ({ dir, logger }: { dir: URL; logger: Logger }) => {
        const root = process.cwd()
        const dist = fileURLToPath(dir)
        const site = readSite(dist)
        fail('Links', checkLinks(site))
        fail('Paths', checkPaths(site))
        fail('Markdown twins', checkTwins(site))
        fail('llms.txt', checkLlms(site))
        fail('Synonyms', checkSynonyms(synonyms as Record<string, { pages: string[] }>, site))

        const codes = JSON.parse(readFileSync(join(root, 'src/generated/errors.json'), 'utf8')) as {
          code: string
        }[]
        const pages = errorPages(root)
        fail(
          'Error pages',
          checkErrorPages(
            codes,
            pages.map((p) => p.code),
            pending.codes,
          ),
        )
        const sources = librarySources(installedLibrary(root).map((p) => p.dir))
        fail(
          'Error messages',
          pages.flatMap((p) => checkMessage(p.message, sources).map((m) => `${p.code}: ${m}`)),
        )

        for (const name of ['llms.txt', 'llms-full.txt', 'llms-api.txt']) {
          const text = site.twins.get(`/${name}`)
          if (text) logger.info(`${name}: ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`)
        }

        const pagefind = await import('pagefind')
        const { index, errors } = await pagefind.createIndex({})
        if (!index) throw new Error(`Pagefind: ${errors.join(', ')}`)
        const added = await index.addDirectory({ path: dist })
        if (added.errors.length) throw new Error(`Pagefind: ${added.errors.join(', ')}`)
        await index.writeFiles({ outputPath: join(dist, 'pagefind') })
        await pagefind.close()
        logger.info(`pagefind: ${added.page_count} pages indexed`)
      },
    },
  }
}
