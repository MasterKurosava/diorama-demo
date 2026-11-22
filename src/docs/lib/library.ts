// The installed library packages, found the way Node finds them: next to the linked monorepo
// packages in development, in the pnpm store when installed from npm.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface LibraryPackage {
  readonly name: string
  readonly dir: string
  readonly manifest: {
    readonly name: string
    readonly private?: boolean
    readonly dependencies?: Record<string, string>
    readonly peerDependencies?: Record<string, string>
  }
}

/** The first `node_modules/<name>` from `from` upwards, with links resolved. */
export function findPackage(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(dir) === dir) return undefined
  }
}

/** `@dioramajs/diorama` and every `@dioramajs/*` package it depends on. */
export function installedLibrary(site = process.cwd()): readonly LibraryPackage[] {
  const entry = findPackage(site, '@dioramajs/diorama')
  if (!entry) throw new Error('@dioramajs/diorama is not installed')
  const read = (dir: string): LibraryPackage => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return { name: manifest.name, dir, manifest }
  }
  const main = read(entry)
  const scoped = Object.keys(main.manifest.dependencies ?? {})
    .filter((name) => name.startsWith('@dioramajs/'))
    .flatMap((name) => {
      const dir = findPackage(entry, name)
      return dir ? [read(dir)] : []
    })
  return [main, ...scoped]
}
