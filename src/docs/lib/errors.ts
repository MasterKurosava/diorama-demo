// Error pages joined with the code unions from the library types.

import { type CollectionEntry, getCollection } from 'astro:content'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeSlug } from './links.ts'

export interface CodeInfo {
  readonly code: string
  readonly union: string
  readonly specifier: string
}

export function codes(): CodeInfo[] {
  const file = join(process.cwd(), 'src/generated/errors.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as CodeInfo[]) : []
}

export interface ErrorPage {
  readonly url: string
  readonly info: CodeInfo
  readonly entry: CollectionEntry<'errors'>
}

export async function errorPages(): Promise<ErrorPage[]> {
  const known = new Map(codes().map((c) => [c.code, c]))
  const entries = await getCollection('errors')
  return entries
    .flatMap((entry) => {
      const info = known.get(entry.data.code)
      return info ? [{ url: `/docs/errors/${codeSlug(entry.data.code)}`, info, entry }] : []
    })
    .sort((a, b) => a.info.code.localeCompare(b.info.code))
}

/** The console line as printed: the code, then the message with placeholders in braces. */
export const consoleLine = (code: string, message: string): string => `${code}: ${message}`
